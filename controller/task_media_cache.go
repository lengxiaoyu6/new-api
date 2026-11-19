package controller

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

var taskVideoCacheQueue chan *model.Task

// StartTaskVideoCache starts a bounded prefetch queue on this instance. It is
// wired before polling starts; a full queue leaves on-demand caching available.
func StartTaskVideoCache(ctx context.Context) {
	if !service.GetTaskArtifactStore().Enabled() {
		return
	}
	queue := make(chan *model.Task, 64)
	taskVideoCacheQueue = queue
	for range 4 {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case task := <-queue:
					artifacts := []relaychannel.TaskArtifact{{Key: "video", Type: "video"}}
					if taskHasPluginExecution(task) {
						var err error
						artifacts, err = projectTaskArtifacts(task)
						if err != nil {
							logger.LogWarn(ctx, common.LogText("Failed to project cached video for task %s: %v", task.TaskID, err))
							continue
						}
					} else if !legacyVideoAvailable(task) {
						continue
					}
					baseURL := strings.TrimRight(system_setting.TaskPublicAddress, "/")
					if baseURL == "" {
						baseURL = strings.TrimRight(system_setting.ServerAddress, "/")
					}
					request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/v1/videos/"+task.TaskID+"/content", nil)
					if err != nil {
						continue
					}
					c := &gin.Context{Request: request}
					for _, artifact := range artifacts {
						if artifact.Type != "video" {
							continue
						}
						if _, err := cacheTaskVideo(c, task, artifact); err != nil {
							logger.LogWarn(ctx, common.LogText("Failed to prefetch video for task %s: %v", task.TaskID, err))
						}
					}
				}
			}
		}()
	}
}

func QueueTaskVideoCache(task *model.Task) {
	if taskVideoCacheQueue == nil || task == nil || task.Status != model.TaskStatusSuccess || !task.ResultRetrievable() {
		return
	}
	snapshot := *task
	snapshot.Data = bytes.Clone(task.Data)
	// Pollers may still reuse their task object. Copy plugin state and channel
	// credentials into this private in-memory snapshot before handing it off.
	privateData, err := common.Marshal(task.PrivateData)
	snapshot.PrivateData = model.TaskPrivateData{}
	if err != nil || common.Unmarshal(privateData, &snapshot.PrivateData) != nil {
		return
	}
	select {
	case taskVideoCacheQueue <- &snapshot:
	default:
		logger.LogWarn(context.Background(), common.LogText("Video cache queue is full; task %s will cache on demand", task.TaskID))
	}
}

// serveCachedTaskVideo is called only after task ownership and artifact identity
// have been checked. Disk failures preserve the existing upstream download.
func serveCachedTaskVideo(c *gin.Context, task *model.Task, artifact relaychannel.TaskArtifact) bool {
	store := service.GetTaskArtifactStore()
	if !store.Enabled() || artifact.Type != "video" {
		return false
	}
	ref, err := cacheTaskVideo(c, task, artifact)
	if errors.Is(err, service.ErrTaskArtifactCacheWrite) {
		logger.LogWarn(c.Request.Context(), common.LogText("Failed to cache video for task %s: %v", task.TaskID, err))
		return false
	}
	if err == nil {
		err = store.Serve(c, task, ref)
		// Cleanup can expire the object between the lookup and opening it.
		if err != nil && !c.Writer.Written() {
			logger.LogWarn(c.Request.Context(), common.LogText("Failed to open cached video for task %s: %v", task.TaskID, err))
			return false
		}
	}
	if err != nil {
		writeTaskMediaProxyError(c, err)
	}
	return true
}

func cacheTaskVideo(c *gin.Context, task *model.Task, artifact relaychannel.TaskArtifact) (*service.StoredArtifactRef, error) {
	// The fill outlives a disconnected caller, so keep no live Gin writer or
	// mutable client request in the singleflight closure.
	fetchContext := c.Copy()
	fetchContext.Request = c.Request.Clone(context.WithoutCancel(c.Request.Context()))
	fetchContext.Request.Method = http.MethodGet
	fetchContext.Request.Header = make(http.Header)
	// Retain the origin for proxy-loop checks, without forwarding client keys.
	for _, name := range []string{"X-Forwarded-Host", "X-Forwarded-Proto"} {
		fetchContext.Request.Header.Set(name, c.Request.Header.Get(name))
	}
	return service.CacheTaskArtifact(c.Request.Context(), task, artifact, func(ctx context.Context) (io.ReadCloser, string, error) {
		fetchContext.Request = fetchContext.Request.WithContext(ctx)
		descriptor := &relaychannel.TaskContentRequest{URL: task.GetResultURL(), Method: http.MethodGet, Credentialless: true}
		if taskHasPluginExecution(task) {
			adaptor, err := initTaskArtifactAdaptor(task)
			if err != nil {
				return nil, "", err
			}
			provider, ok := adaptor.(relaychannel.TaskContentRequestProvider)
			if !ok {
				return nil, "", errTaskArtifactPluginUnavailable
			}
			descriptor, err = provider.BuildContentRequest(ctx, task, artifact.Key, relaychannel.TaskArtifactClientRequest{
				Method: http.MethodGet, Headers: map[string]string{},
			})
			if err != nil {
				return nil, "", err
			}
		}
		resp, err := requestTaskMedia(fetchContext, task, descriptor)
		if err != nil {
			return nil, "", err
		}
		// A range or conditional reply cannot become a complete cache entry.
		if resp.StatusCode != http.StatusOK {
			defer resp.Body.Close()
			if err := taskMediaResponseError(resp); err != nil {
				return nil, "", err
			}
			return nil, "", &taskMediaProxyError{
				status: http.StatusBadGateway, code: "artifact_upstream_error",
				message: "Artifact upstream did not return complete content",
			}
		}
		mimeType := resp.Header.Get("Content-Type")
		if mimeType == "" {
			mimeType = artifact.MimeType
		}
		if mimeType == "" {
			mimeType = "video/mp4"
		}
		return resp.Body, mimeType, nil
	})
}
