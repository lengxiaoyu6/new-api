package service

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

// StoredArtifactRef describes a persisted artifact object.
type StoredArtifactRef struct {
	Backend   string
	Bucket    string
	ObjectKey string
	MimeType  string
	Size      int64
	StoredAt  time.Time
}

// TaskArtifactStore is the persistence boundary for generated artifact bytes.
// types.TaskArtifact is re-exported by relay/channel as channel.TaskArtifact.
type TaskArtifactStore interface {
	Enabled() bool
	Resolve(task *model.Task, artifactKey string) (*StoredArtifactRef, error)
	Persist(ctx context.Context, task *model.Task, artifact types.TaskArtifact, content io.Reader) (*StoredArtifactRef, error)
	Serve(c *gin.Context, task *model.Task, ref *StoredArtifactRef) error
}

var ErrTaskArtifactStoreDisabled = errors.New("task artifact store is disabled")

type disabledArtifactStore struct{}

func (disabledArtifactStore) Enabled() bool {
	return false
}

func (disabledArtifactStore) Resolve(*model.Task, string) (*StoredArtifactRef, error) {
	return nil, nil
}

func (disabledArtifactStore) Persist(context.Context, *model.Task, types.TaskArtifact, io.Reader) (*StoredArtifactRef, error) {
	return nil, ErrTaskArtifactStoreDisabled
}

func (disabledArtifactStore) Serve(*gin.Context, *model.Task, *StoredArtifactRef) error {
	return ErrTaskArtifactStoreDisabled
}

var taskArtifactStore TaskArtifactStore = &disabledArtifactStore{}

// InitTaskArtifactStore runs after startup environment loading, before serving
// requests or polling tasks. The caller owns the cleanup loop's lifetime.
func InitTaskArtifactStore(ctx context.Context) error {
	config := system_setting.LoadTaskArtifactStoreConfig()
	if config.Mode != system_setting.TaskArtifactStoreModeLocal {
		taskArtifactStore = &disabledArtifactStore{}
		return nil
	}
	store, err := newLocalArtifactStore(config.LocalDir, time.Duration(config.LocalTTLHours)*time.Hour)
	if err != nil {
		return err
	}
	if err := store.cleanup(true); err != nil {
		return err
	}
	taskArtifactStore = store
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := store.cleanup(false); err != nil {
					common.SysError(common.LogText("Failed to clean local task artifact cache: %v", err))
				}
			}
		}
	}()
	return nil
}

// GetTaskArtifactStore returns the process-wide artifact storage backend.
func GetTaskArtifactStore() TaskArtifactStore {
	return taskArtifactStore
}
