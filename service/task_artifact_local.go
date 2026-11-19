package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"golang.org/x/sync/singleflight"
)

const taskArtifactCacheFillTimeout = 30 * time.Minute

var ErrTaskArtifactCacheWrite = errors.New("failed to save task artifact cache")

var errTaskArtifactCacheRead = errors.New("failed to read complete task artifact")

type localArtifactStore struct {
	root    string
	ttl     time.Duration
	now     func() time.Time
	mu      sync.Mutex
	fills   singleflight.Group
	slots   chan struct{}
	pending map[string]struct{}
}

func newLocalArtifactStore(directory string, ttl time.Duration) (*localArtifactStore, error) {
	root, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	return &localArtifactStore{
		root: root, ttl: ttl, now: time.Now, slots: make(chan struct{}, 4),
		pending: make(map[string]struct{}),
	}, nil
}

func (s *localArtifactStore) Enabled() bool { return true }

// CacheTaskArtifact shares one complete upstream fetch per task output, even
// between a background prefetch and client requests. A disconnect only stops
// waiting; the bounded fill continues and remains useful to other clients.
func CacheTaskArtifact(ctx context.Context, task *model.Task, artifact types.TaskArtifact,
	fetch func(context.Context) (io.ReadCloser, string, error),
) (*StoredArtifactRef, error) {
	store, ok := GetTaskArtifactStore().(*localArtifactStore)
	if !ok || artifact.Type != "video" {
		return nil, ErrTaskArtifactStoreDisabled
	}
	key := localArtifactObjectKey(task, artifact.Key)
	result := store.fills.DoChan(key, func() (any, error) {
		if ref, err := store.Resolve(task, artifact.Key); err != nil || ref != nil {
			if err != nil {
				return nil, fmt.Errorf("%w: %v", ErrTaskArtifactCacheWrite, err)
			}
			return ref, nil
		}
		fillCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), taskArtifactCacheFillTimeout)
		defer cancel()
		select {
		case store.slots <- struct{}{}:
			defer func() { <-store.slots }()
		case <-fillCtx.Done():
			return nil, fillCtx.Err()
		}
		content, mimeType, err := fetch(fillCtx)
		if err != nil {
			return nil, err
		}
		defer content.Close()
		artifact.MimeType = mimeType
		ref, err := store.Persist(fillCtx, task, artifact, content)
		if err != nil {
			if errors.Is(err, errTaskArtifactCacheRead) || fillCtx.Err() != nil {
				return nil, err
			}
			return nil, fmt.Errorf("%w: %v", ErrTaskArtifactCacheWrite, err)
		}
		return ref, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-result:
		if result.Err != nil {
			return nil, result.Err
		}
		return result.Val.(*StoredArtifactRef), nil
	}
}

func localArtifactObjectKey(task *model.Task, artifactKey string) string {
	sum := sha256.Sum256(fmt.Appendf(nil, "%d\x00%d\x00%d\x00%s\x00%s", task.ID, task.UserId, task.ChannelId, task.TaskID, artifactKey))
	return hex.EncodeToString(sum[:])
}

func (s *localArtifactStore) Resolve(task *model.Task, artifactKey string) (*StoredArtifactRef, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resolve(localArtifactObjectKey(task, artifactKey))
}

func (s *localArtifactStore) resolve(key string) (*StoredArtifactRef, error) {
	directory := filepath.Join(s.root, key)
	raw, err := os.ReadFile(filepath.Join(directory, "metadata.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, os.RemoveAll(directory)
	}
	if err != nil {
		return nil, err
	}
	var ref StoredArtifactRef
	if common.Unmarshal(raw, &ref) != nil || ref.Backend != "local" || ref.ObjectKey != key ||
		ref.StoredAt.IsZero() || !s.now().Before(ref.StoredAt.Add(s.ttl)) {
		return nil, os.RemoveAll(directory)
	}
	info, err := os.Stat(filepath.Join(directory, "content"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, os.RemoveAll(directory)
	}
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() != ref.Size {
		return nil, os.RemoveAll(directory)
	}
	return &ref, nil
}

func (s *localArtifactStore) Persist(ctx context.Context, task *model.Task, artifact types.TaskArtifact, content io.Reader) (*StoredArtifactRef, error) {
	s.mu.Lock()
	directory, err := os.MkdirTemp(s.root, ".pending-")
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.pending[filepath.Base(directory)] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, filepath.Base(directory))
		s.mu.Unlock()
		_ = os.RemoveAll(directory)
	}()
	file, err := os.OpenFile(filepath.Join(directory, "content"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	size, copyErr := io.Copy(file, &artifactCacheReader{ctx: ctx, reader: content})
	closeErr := file.Close()
	if copyErr != nil {
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	key := localArtifactObjectKey(task, artifact.Key)
	ref := &StoredArtifactRef{
		Backend: "local", ObjectKey: key, MimeType: artifact.MimeType,
		Size: size, StoredAt: s.now().UTC(),
	}
	raw, err := common.Marshal(ref)
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(directory, "metadata.json"), raw, 0600); err != nil {
		return nil, err
	}
	// Publish the directory only after both files are complete. Readers never
	// observe a partial video or metadata from another generation.
	s.mu.Lock()
	defer s.mu.Unlock()
	existing, err := s.resolve(key)
	if err != nil || existing != nil {
		return existing, err
	}
	if err := os.Rename(directory, filepath.Join(s.root, key)); err != nil {
		return nil, err
	}
	return ref, nil
}

func (s *localArtifactStore) Serve(c *gin.Context, task *model.Task, ref *StoredArtifactRef) error {
	if ref == nil || ref.Backend != "local" || !validLocalArtifactObjectKey(ref.ObjectKey) {
		return os.ErrNotExist
	}
	s.mu.Lock()
	current, err := s.resolve(ref.ObjectKey)
	var file *os.File
	if err == nil && current != nil {
		file, err = os.Open(filepath.Join(s.root, ref.ObjectKey, "content"))
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if file == nil {
		return os.ErrNotExist
	}
	defer file.Close()
	header := c.Writer.Header()
	header.Set("Cache-Control", "private, no-store")
	header.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	if current.MimeType != "" {
		header.Set("Content-Type", current.MimeType)
	}
	header.Set("ETag", fmt.Sprintf(`"%s-%x"`, current.ObjectKey, current.StoredAt.UnixNano()))
	http.ServeContent(privateArtifactResponseWriter{c.Writer}, c.Request, "video", current.StoredAt, file)
	c.Writer.WriteHeaderNow()
	return nil
}

// ServeContent removes Cache-Control when answering errors such as an invalid
// range. Artifact errors must retain the same private-cache policy.
type privateArtifactResponseWriter struct {
	http.ResponseWriter
}

func (w privateArtifactResponseWriter) WriteHeader(status int) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.ResponseWriter.WriteHeader(status)
}

func validLocalArtifactObjectKey(key string) bool {
	decoded, err := hex.DecodeString(key)
	return err == nil && len(decoded) == sha256.Size && strings.ToLower(key) == key
}

// cleanup removes only this store's object directories and unfinished fills.
// On startup no fills are active; during normal operation active fills and open
// readers are protected by the publication lock and file descriptors.
func (s *localArtifactStore) cleanup(startup bool) error {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		s.mu.Lock()
		if strings.HasPrefix(entry.Name(), ".pending-") {
			_, active := s.pending[entry.Name()]
			if startup || !active {
				err = os.RemoveAll(filepath.Join(s.root, entry.Name()))
			}
		} else if validLocalArtifactObjectKey(entry.Name()) {
			_, err = s.resolve(entry.Name())
		}
		s.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

type artifactCacheReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *artifactCacheReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(data)
	if err != nil && !errors.Is(err, io.EOF) {
		return n, fmt.Errorf("%w: %v", errTaskArtifactCacheRead, err)
	}
	return n, err
}
