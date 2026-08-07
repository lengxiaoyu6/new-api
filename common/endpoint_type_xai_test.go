package common

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"

	"github.com/stretchr/testify/assert"
)

// TestGetEndpointTypesByChannelTypeXaiVideo confirms the xAI video model is
// advertised as an OpenAI Video endpoint (so /v1/videos routing is discoverable)
// while other xAI models keep chat/responses capabilities only.
func TestGetEndpointTypesByChannelTypeXaiVideo(t *testing.T) {
	videoEndpoints := GetEndpointTypesByChannelType(constant.ChannelTypeXai, "grok-imagine-video")
	assert.Contains(t, videoEndpoints, constant.EndpointTypeOpenAIVideo)
	assert.NotContains(t, videoEndpoints, constant.EndpointTypeOpenAI)

	chatEndpoints := GetEndpointTypesByChannelType(constant.ChannelTypeXai, "grok-3")
	assert.Contains(t, chatEndpoints, constant.EndpointTypeOpenAI)
	assert.NotContains(t, chatEndpoints, constant.EndpointTypeOpenAIVideo)
}

func TestIsXaiVideoModel(t *testing.T) {
	assert.True(t, IsXaiVideoModel("grok-imagine-video"))
	assert.False(t, IsXaiVideoModel("grok-imagine-image"))
	assert.False(t, IsXaiVideoModel("grok-imagine-image-pro"))
	assert.False(t, IsXaiVideoModel("grok-3"))
}
