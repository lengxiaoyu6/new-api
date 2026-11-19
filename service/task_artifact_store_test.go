package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/iotest"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDisabledTaskArtifactStoreHasNoStorageBehavior(t *testing.T) {
	store := GetTaskArtifactStore()
	require.NotNil(t, store)
	assert.False(t, store.Enabled())

	task := &model.Task{TaskID: "task-disabled-store"}
	ref, err := store.Resolve(task, "video")
	require.NoError(t, err)
	assert.Nil(t, ref)

	ref, err = store.Persist(t.Context(), task, types.TaskArtifact{Key: "video", Type: "video"}, strings.NewReader("content"))
	assert.Nil(t, ref)
	assert.ErrorIs(t, err, ErrTaskArtifactStoreDisabled)
	assert.ErrorIs(t, store.Serve(&gin.Context{}, task, &StoredArtifactRef{Backend: "s3"}), ErrTaskArtifactStoreDisabled)
	assert.Same(t, store, GetTaskArtifactStore())
}

var _ TaskArtifactStore = disabledArtifactStore{}

func TestLocalTaskArtifactExpirationAndCleanup(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 11, 19, 0, 0, 0, 0, time.UTC)
	store, err := newLocalArtifactStore(root, 48*time.Hour)
	require.NoError(t, err)
	store.now = func() time.Time { return now }
	task := &model.Task{TaskID: "../../outside", UserId: 7, ChannelId: 1}
	artifact := types.TaskArtifact{Key: "video", Type: "video", MimeType: "video/mp4"}
	ref, err := store.Persist(t.Context(), task, artifact, strings.NewReader("complete-video"))
	require.NoError(t, err)
	assert.Equal(t, int64(14), ref.Size)
	assert.DirExists(t, filepath.Join(root, ref.ObjectKey))

	// Opening through another store instance preserves the original expiry.
	restarted, err := newLocalArtifactStore(root, 48*time.Hour)
	require.NoError(t, err)
	restarted.now = func() time.Time { return now }
	now = now.Add(47 * time.Hour)
	resolved, err := restarted.Resolve(task, artifact.Key)
	require.NoError(t, err)
	require.NotNil(t, resolved)
	assert.Equal(t, ref.StoredAt, resolved.StoredAt)
	for _, tc := range []struct {
		method string
		ranges string
		status int
		body   string
	}{
		{http.MethodGet, "", http.StatusOK, "complete-video"},
		{http.MethodHead, "", http.StatusOK, ""},
		{http.MethodGet, "bytes=9-13", http.StatusPartialContent, "video"},
		{http.MethodGet, "bytes=99-", http.StatusRequestedRangeNotSatisfiable, ""},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(tc.method, "/content", nil)
		c.Request.Header.Set("Range", tc.ranges)
		require.NoError(t, restarted.Serve(c, task, resolved))
		assert.Equal(t, tc.status, recorder.Code)
		assert.Equal(t, "private, no-store", recorder.Header().Get("Cache-Control"))
		if tc.status != http.StatusRequestedRangeNotSatisfiable {
			assert.Equal(t, tc.body, recorder.Body.String())
		}
		if tc.status == http.StatusPartialContent {
			assert.Equal(t, "bytes 9-13/14", recorder.Header().Get("Content-Range"))
		}
	}
	foreign, err := restarted.Resolve(&model.Task{TaskID: task.TaskID, UserId: 8, ChannelId: 1}, artifact.Key)
	require.NoError(t, err)
	assert.Nil(t, foreign)

	// Accesses do not extend the 48 hours. Cleanup reclaims unrequested objects.
	now = now.Add(time.Hour)
	require.NoError(t, os.Mkdir(filepath.Join(root, ".pending-crashed"), 0700))
	require.NoError(t, os.Mkdir(filepath.Join(root, "unrelated"), 0700))
	require.NoError(t, restarted.cleanup(false))
	assert.NoDirExists(t, filepath.Join(root, ref.ObjectKey))
	assert.NoDirExists(t, filepath.Join(root, ".pending-crashed"))
	assert.DirExists(t, filepath.Join(root, "unrelated"))
	resolved, err = restarted.Resolve(task, artifact.Key)
	require.NoError(t, err)
	assert.Nil(t, resolved)
}

func TestLocalTaskArtifactIncompleteWritesAreRemoved(t *testing.T) {
	store, err := newLocalArtifactStore(t.TempDir(), 48*time.Hour)
	require.NoError(t, err)
	task := &model.Task{TaskID: "task-incomplete", UserId: 7}
	artifact := types.TaskArtifact{Key: "video", Type: "video"}
	reader := io.MultiReader(strings.NewReader("partial"), iotest.ErrReader(io.ErrUnexpectedEOF))
	ref, err := store.Persist(t.Context(), task, artifact, reader)
	require.ErrorIs(t, err, errTaskArtifactCacheRead)
	assert.Nil(t, ref)
	ref, err = store.Resolve(task, artifact.Key)
	require.NoError(t, err)
	assert.Nil(t, ref)
	entries, err := os.ReadDir(store.root)
	require.NoError(t, err)
	assert.Empty(t, entries)

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = store.Persist(ctx, task, artifact, strings.NewReader("video"))
	require.ErrorIs(t, err, context.Canceled)
	entries, err = os.ReadDir(store.root)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestLocalTaskArtifactSharesFillAfterClientDisconnect(t *testing.T) {
	store, err := newLocalArtifactStore(t.TempDir(), 48*time.Hour)
	require.NoError(t, err)
	previous := taskArtifactStore
	taskArtifactStore = store
	t.Cleanup(func() { taskArtifactStore = previous })
	task := &model.Task{TaskID: "task-shared", UserId: 7}
	artifact := types.TaskArtifact{Key: "video", Type: "video"}
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	fetch := func(ctx context.Context) (io.ReadCloser, string, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
			return io.NopCloser(strings.NewReader("shared-video")), "video/mp4", nil
		case <-ctx.Done():
			return nil, "", ctx.Err()
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	firstDone := make(chan error, 1)
	go func() {
		_, err := CacheTaskArtifact(ctx, task, artifact, fetch)
		firstDone <- err
	}()
	<-started
	cancel()
	require.ErrorIs(t, <-firstDone, context.Canceled)
	secondDone := make(chan error, 1)
	go func() {
		ref, err := CacheTaskArtifact(t.Context(), task, artifact, fetch)
		if err == nil {
			assert.Equal(t, int64(12), ref.Size)
		}
		secondDone <- err
	}()
	close(release)
	require.NoError(t, <-secondDone)
	assert.Equal(t, int32(1), calls.Load())
	_, err = CacheTaskArtifact(t.Context(), task, artifact, fetch)
	require.NoError(t, err)
	assert.Equal(t, int32(1), calls.Load())
}
