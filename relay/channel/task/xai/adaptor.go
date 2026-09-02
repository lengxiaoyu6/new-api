package xai

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	videodto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

// ============================
// Request / Response structures
// ============================

// submitResponse is the xAI video submission response. The native task
// identifier is request_id; id is accepted for compatibility with older relay
// shapes.
type submitResponse struct {
	ID        string         `json:"id"`
	RequestID string         `json:"request_id"`
	Error     *upstreamError `json:"error,omitempty"`
}

// fetchResponse is the xAI video polling response.
//
//	{"status":"pending","progress":1}
//	{"status":"done","progress":100,"video":{"duration":8,"url":"/v1/videos/<id>/content"}}
type fetchResponse struct {
	Status   string `json:"status"`
	Progress int    `json:"progress"`
	VideoURL string `json:"video_url,omitempty"`
	Video    struct {
		URL string `json:"url"`
	} `json:"video"`
	Error *upstreamError `json:"error,omitempty"`
}

func (r fetchResponse) resultURL() string {
	if r.Video.URL != "" {
		return r.Video.URL
	}
	return r.VideoURL
}

type upstreamError struct {
	Message string `json:"message"`
	Code    string `json:"code"`
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	// ValidateMultipartDirect validates prompt/model and bounds the duration
	// against relaycommon.MaxTaskDurationSeconds before it becomes a billing
	// multiplier.
	return relaycommon.ValidateMultipartDirect(c, info)
}

// EstimateBilling multiplies the base model price by the requested video
// duration (seconds). The value is already bounded by ValidateMultipartDirect.
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}

	seconds, _ := strconv.Atoi(req.Seconds)
	if seconds == 0 {
		seconds = req.Duration
	}
	if seconds <= 0 {
		seconds = 4
	}

	return map[string]float64{
		"seconds": float64(seconds),
	}
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v1/videos/generations", a.baseURL), nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, errors.Wrap(err, "get_request_body_failed")
	}
	cachedBody, err := storage.Bytes()
	if err != nil {
		return nil, errors.Wrap(err, "read_body_bytes_failed")
	}

	var bodyMap map[string]interface{}
	if err := common.Unmarshal(cachedBody, &bodyMap); err != nil {
		return nil, errors.Wrap(err, "unmarshal_request_body_failed")
	}
	bodyMap["model"] = info.UpstreamModelName
	newBody, err := common.Marshal(bodyMap)
	if err != nil {
		return nil, errors.Wrap(err, "marshal_request_body_failed")
	}
	return bytes.NewReader(newBody), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// ParseResponse adapts the legacy xAI response to the transport-independent
// task result consumed by the current relay pipeline.
func (a *TaskAdaptor) ParseResponse(_ *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (*channel.TaskSubmitResponse, *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	var parsed submitResponse
	if err := common.Unmarshal(responseBody, &parsed); err != nil {
		return nil, service.TaskErrorWrapper(err, "unmarshal_response_body_failed", http.StatusBadGateway)
	}
	if parsed.Error != nil {
		return nil, service.TaskErrorWrapper(fmt.Errorf("%s", parsed.Error.Message), "task_submit_failed", http.StatusBadGateway)
	}
	upstreamTaskID := parsed.RequestID
	if upstreamTaskID == "" {
		upstreamTaskID = parsed.ID
	}
	if upstreamTaskID == "" {
		return nil, service.TaskErrorWrapper(fmt.Errorf("request_id/id is empty"), "invalid_response", http.StatusBadGateway)
	}
	openAIVideo := videodto.NewOpenAIVideo()
	openAIVideo.ID = info.PublicTaskID
	openAIVideo.TaskID = info.PublicTaskID
	openAIVideo.Model = info.OriginModelName
	return &channel.TaskSubmitResponse{
		UpstreamTaskID: upstreamTaskID,
		TaskData:       responseBody,
		ClientResponse: openAIVideo,
	}, nil
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	var dResp submitResponse
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}
	if dResp.Error != nil {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", dResp.Error.Message), "task_submit_failed", http.StatusInternalServerError)
		return
	}
	upstreamTaskID := dResp.RequestID
	if upstreamTaskID == "" {
		upstreamTaskID = dResp.ID
	}
	if upstreamTaskID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("request_id/id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	// Return an OpenAI-video-shaped object keyed by the public task ID.
	openAIVideo := videodto.NewOpenAIVideo()
	openAIVideo.ID = info.PublicTaskID
	openAIVideo.TaskID = info.PublicTaskID
	openAIVideo.Model = info.OriginModelName
	openAIVideo.Status = videodto.VideoStatusQueued
	c.JSON(http.StatusOK, openAIVideo)

	return upstreamTaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := fmt.Sprintf("%s/v1/videos/%s", baseUrl, taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	resTask := fetchResponse{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{Code: 0}

	switch strings.ToLower(strings.TrimSpace(resTask.Status)) {
	case "pending", "queued":
		taskResult.Status = model.TaskStatusQueued
	case "processing", "in_progress", "running":
		taskResult.Status = model.TaskStatusInProgress
	case "done", "completed", "success", "succeeded":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Url = resTask.resultURL()
	case "failed", "failure", "error", "cancelled", "canceled", "expired":
		taskResult.Status = model.TaskStatusFailure
		if resTask.Error != nil && resTask.Error.Message != "" {
			taskResult.Reason = resTask.Error.Message
		} else {
			taskResult.Reason = "task failed"
		}
	default:
	}

	if resTask.Progress > 0 && resTask.Progress < 100 {
		taskResult.Progress = fmt.Sprintf("%d%%", resTask.Progress)
	}

	return &taskResult, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	openAIVideo := videodto.NewOpenAIVideo()
	openAIVideo.ID = task.TaskID
	openAIVideo.TaskID = task.TaskID
	openAIVideo.Status = task.Status.ToVideoStatus()
	openAIVideo.SetProgressStr(task.Progress)
	openAIVideo.Model = task.Properties.OriginModelName
	openAIVideo.CreatedAt = task.CreatedAt
	openAIVideo.CompletedAt = task.UpdatedAt

	resultURL := task.GetResultURL()
	if len(task.Data) > 0 {
		resTask := fetchResponse{}
		if err := common.Unmarshal(task.Data, &resTask); err == nil {
			if dataURL := resTask.resultURL(); dataURL != "" {
				resultURL = dataURL
			}
		}
	}
	openAIVideo.SetMetadata("url", resultURL)

	if task.Status == model.TaskStatusFailure && task.FailReason != "" {
		openAIVideo.Error = &videodto.OpenAIVideoError{Message: task.FailReason}
	}

	return common.Marshal(openAIVideo)
}
