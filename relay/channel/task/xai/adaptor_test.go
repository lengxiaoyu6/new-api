package xai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBuildRequestURL confirms the adaptor targets xAI's native video
// submission path (/v1/videos/generations), not the OpenAI/Sora /v1/videos path.
func TestBuildRequestURL(t *testing.T) {
	a := &TaskAdaptor{baseURL: "https://api.x.ai"}
	url, err := a.BuildRequestURL(&relaycommon.RelayInfo{})
	require.NoError(t, err)
	assert.Equal(t, "https://api.x.ai/v1/videos/generations", url)
}

// TestParseTaskResultStatusMapping locks the xAI status vocabulary
// (pending/done/failed) to the internal task statuses.
func TestParseTaskResultStatusMapping(t *testing.T) {
	a := &TaskAdaptor{}
	cases := []struct {
		name       string
		body       string
		wantStatus string
		wantReason string
		wantProg   string
	}{
		{"pending", `{"status":"pending","progress":1}`, model.TaskStatusQueued, "", "1%"},
		{"in_progress", `{"status":"processing","progress":50}`, model.TaskStatusInProgress, "", "50%"},
		{"done", `{"status":"done","progress":100,"video":{"duration":8,"url":"/v1/videos/x/content"}}`, model.TaskStatusSuccess, "", ""},
		{"failed_with_reason", `{"status":"failed","error":{"message":"boom"}}`, model.TaskStatusFailure, "boom", ""},
		{"failed_without_reason", `{"status":"failed"}`, model.TaskStatusFailure, "task failed", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info, err := a.ParseTaskResult([]byte(tc.body))
			require.NoError(t, err)
			require.NotNil(t, info)
			assert.Equal(t, tc.wantStatus, info.Status)
			assert.Equal(t, tc.wantReason, info.Reason)
			assert.Equal(t, tc.wantProg, info.Progress)
		})
	}
}

// TestDoResponseParsesRequestID confirms xAI's request_id is used as the
// upstream task ID and the client receives the public task ID.
func TestDoResponseParsesRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"request_id":"req_abc123"}`)),
	}
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{}}
	info.PublicTaskID = "task_public"
	info.OriginModelName = "grok-imagine-video"

	a := &TaskAdaptor{}
	upstreamID, taskData, taskErr := a.DoResponse(c, resp, info)
	require.Nil(t, taskErr)
	assert.Equal(t, "req_abc123", upstreamID)
	assert.Contains(t, string(taskData), "req_abc123")
	// The client-facing response must expose the public ID, never the upstream one.
	assert.Contains(t, w.Body.String(), "task_public")
	assert.NotContains(t, w.Body.String(), "req_abc123")
}

// TestDoResponseRejectsMissingRequestID guards against silently accepting an
// upstream response with no task identifier.
func TestDoResponseRejectsMissingRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{}`)),
	}
	a := &TaskAdaptor{}
	_, _, taskErr := a.DoResponse(c, resp, &relaycommon.RelayInfo{})
	require.NotNil(t, taskErr)
}
