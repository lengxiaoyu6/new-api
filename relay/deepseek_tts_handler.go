package relay

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relay/requestplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// DeepSeekTTSHelper streams native HTTP audio and charges the complete input
// once audio begins. A submitted synthesis is never automatically replayed.
func DeepSeekTTSHelper(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	info.InitChannelMeta(c)
	switch info.ChannelType {
	case constant.ChannelTypeDeepSeek, constant.ChannelTypeNewAPI,
		constant.ChannelTypeSub2API, constant.ChannelTypeAdvancedCustom:
	default:
		if info.ApiType != constant.APITypeProviderPlugin {
			return types.NewError(fmt.Errorf("channel does not support %s", c.Request.URL.Path), types.ErrorCodeInvalidRequest)
		}
	}
	request, ok := info.Request.(*dto.DeepSeekTTSRequest)
	if !ok {
		return types.NewError(errors.New("invalid TTS request"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ModelMappedHelper(c, info, request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}
	body, apiErr := requestplugin.Outbound(c, info, request.RawBody)
	if apiErr != nil {
		return apiErr
	}
	var err error
	if len(info.ParamOverride) > 0 {
		body, err = relaycommon.ApplyParamOverrideWithRelayInfo(body, info)
		if err != nil {
			return newAPIErrorFromParamOverride(err)
		}
	}
	if len(body) > dto.MaxTTSRequestSize {
		return types.NewError(errors.New("TTS request body must be at most 64 KiB"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	var outbound dto.DeepSeekTTSRequest
	if err := common.Unmarshal(body, &outbound); err != nil {
		return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := outbound.Validate(); err != nil {
		return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	// The reserved quantity and its text stay fixed after pricing, even when
	// a channel override or outbound hook changes synthesis options.
	if outbound.Text != request.Text {
		return types.NewError(errors.New("TTS text cannot change after billing reservation"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if apiErr := requestplugin.Egress(c, info, body); apiErr != nil {
		return apiErr
	}
	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	if err := c.Request.Context().Err(); err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	parent := c.Request
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent.Context()), 180*time.Second)
	defer cancel()
	c.Request = parent.WithContext(ctx)
	defer func() { c.Request = parent }()

	response, err := adaptor.DoRequest(c, info, bytes.NewReader(body))
	if err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	resp, ok := response.(*http.Response)
	if !ok || resp == nil {
		return types.NewError(errors.New("invalid HTTP response"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := service.RelayErrorHandler(ctx, resp, false)
		service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
		return types.NewError(apiErr, types.ErrorCodeBadResponseStatusCode, types.ErrOptionWithSkipRetry())
	}
	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(strings.ToLower(contentType), "audio/") && !strings.HasPrefix(strings.ToLower(contentType), "application/octet-stream") {
		// A JSON error must never be emitted as a successful audio response.
		resp.StatusCode = http.StatusBadGateway
		apiErr := service.RelayErrorHandler(ctx, resp, false)
		return types.NewError(apiErr, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	reader := bufio.NewReader(resp.Body)
	if _, err := reader.Peek(1); err != nil {
		return types.NewError(err, types.ErrorCodeReadResponseBodyFailed, types.ErrOptionWithSkipRetry())
	}
	c.Header("Content-Type", contentType)
	if disposition := resp.Header.Get("Content-Disposition"); disposition != "" {
		c.Header("Content-Disposition", disposition)
	}
	c.Status(resp.StatusCode)
	info.SetFirstResponseTime()
	buffer := make([]byte, 32*1024)
	clientDisconnected := false
	for {
		n, readErr := reader.Read(buffer)
		if n > 0 && !clientDisconnected {
			_, writeErr := c.Writer.Write(buffer[:n])
			clientDisconnected = writeErr != nil || parent.Context().Err() != nil
			if !clientDisconnected {
				c.Writer.Flush()
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				logger.LogWarn(c, "DeepSeek TTS audio response interrupted: %s", readErr.Error())
			}
			break
		}
	}
	// Audio synthesis has started. A downstream disconnect or interrupted
	// audio response keeps the full input charge, with no replay or JSON suffix.
	info.BillingCharacterCount = &request.CharacterCount
	service.PostTextConsumeQuota(c, info, &dto.Usage{}, nil)
	return nil
}
