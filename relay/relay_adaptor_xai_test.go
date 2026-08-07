package relay

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	taskxai "github.com/QuantumNous/new-api/relay/channel/task/xai"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetTaskAdaptorXai is the direct regression for issue #6358: channel type
// 48 (xAI) previously had no task adaptor, so GetTaskAdaptor returned nil and
// RelayTaskSubmit rejected every video request with "invalid api platform: 48".
func TestGetTaskAdaptorXai(t *testing.T) {
	platform := constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai))
	adaptor := GetTaskAdaptor(platform)
	require.NotNil(t, adaptor, "xAI channel (type 48) must resolve to a task adaptor")
	assert.IsType(t, &taskxai.TaskAdaptor{}, adaptor)
}
