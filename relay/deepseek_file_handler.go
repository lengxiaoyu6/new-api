package relay

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relay/requestplugin"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/MoeForge/moego/ojson"
	"github.com/gin-gonic/gin"
)

// DeepSeekFileHelper forwards native OCR and ASR multipart bodies unchanged.
// Recognition and settlement survive a downstream disconnect, and submitted
// recognition requests are never replayed automatically.
func DeepSeekFileHelper(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	info.InitChannelMeta(c)
	switch info.ChannelType {
	case constant.ChannelTypeDeepSeek, constant.ChannelTypeNewAPI,
		constant.ChannelTypeSub2API, constant.ChannelTypeAdvancedCustom:
	default:
		if info.ApiType != constant.APITypeProviderPlugin {
			return types.NewError(fmt.Errorf("channel does not support %s", c.Request.URL.Path), types.ErrorCodeInvalidRequest)
		}
	}
	_, ocr := info.Request.(*dto.DeepSeekOCRRequest)
	_, asr := info.Request.(*dto.DeepSeekASRRequest)
	if !ocr && !asr {
		return types.NewError(errors.New("invalid multipart tool request"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ModelMappedHelper(c, info, info.Request); err != nil {
		return types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}
	if len(info.ParamOverride) > 0 {
		return types.NewError(errors.New("parameter overrides are not supported for multipart tool requests"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if apiErr := requestplugin.PassThrough(c, info, nil); apiErr != nil {
		return apiErr
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return types.NewError(err, types.ErrorCodeReadRequestBodyFailed, types.ErrOptionWithSkipRetry())
	}
	body := common.NewReplayableBodyReader(storage)
	if closer, ok := body.(io.Closer); ok {
		defer closer.Close()
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

	response, err := adaptor.DoRequest(c, info, body)
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

	// Leading JSON whitespace is the provider's heartbeat. Forward and flush
	// it immediately, while keeping the final JSON available for validation.
	reader := bufio.NewReader(resp.Body)
	c.Header("Content-Type", "application/json")
	for {
		b, err := reader.ReadByte()
		if err != nil {
			return types.NewError(err, types.ErrorCodeReadResponseBodyFailed, types.ErrOptionWithSkipRetry())
		}
		if b != '\n' && b != '\r' && b != ' ' && b != '\t' {
			if err := reader.UnreadByte(); err != nil {
				return types.NewError(err, types.ErrorCodeReadResponseBodyFailed, types.ErrOptionWithSkipRetry())
			}
			break
		}
		_, _ = c.Writer.Write([]byte{b})
		c.Writer.Flush()
	}
	responseBody, err := io.ReadAll(reader)
	if err != nil {
		return types.NewError(err, types.ErrorCodeReadResponseBodyFailed, types.ErrOptionWithSkipRetry())
	}
	// An error after recognition starts arrives with HTTP 200, possibly after
	// heartbeats. Let the controller emit one error JSON and refund normally.
	if apiError := ojson.GetBytes(responseBody, "error"); apiError.Exists() && apiError.Raw != "null" {
		resp.Body = io.NopCloser(bytes.NewReader(responseBody))
		resp.StatusCode = http.StatusBadGateway
		apiErr := service.RelayErrorHandler(ctx, resp, false)
		return types.NewError(apiErr, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	if asr {
		var result struct {
			Text       *string `json:"text"`
			DurationMS int64   `json:"duration_ms"`
		}
		if err := common.Unmarshal(responseBody, &result); err != nil {
			return types.NewError(err, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
		}
		if result.Text == nil || result.DurationMS <= 0 || result.DurationMS > dto.MaxASRDurationSeconds*1000 {
			return types.NewError(errors.New("invalid ASR text or duration_ms"), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
		}
		seconds := int((result.DurationMS + 999) / 1000)
		info.BillingAudioSeconds = &seconds
		_, _ = c.Writer.Write(responseBody)
		service.PostTextConsumeQuota(c, info, &dto.Usage{}, nil)
		return nil
	}
	var result struct {
		Object    string `json:"object"`
		PageCount int    `json:"page_count"`
		Pages     []struct {
			Index int     `json:"index"`
			Text  *string `json:"text"`
		} `json:"pages"`
	}
	if err := common.Unmarshal(responseBody, &result); err != nil {
		return types.NewError(err, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	if result.Object != "ocr.result" || result.PageCount < 1 || result.PageCount > dto.MaxOCRPages || result.PageCount != len(result.Pages) {
		return types.NewError(errors.New("invalid OCR page_count or pages"), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	for i, page := range result.Pages {
		if page.Index != i || page.Text == nil {
			return types.NewError(errors.New("invalid OCR page result"), types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
		}
	}
	info.BillingPageCount = &result.PageCount
	_, _ = c.Writer.Write(responseBody)
	// Token usage is explicitly reference-only. A successful OCR result
	// settles its page quantity even when the client can no longer read it.
	service.PostTextConsumeQuota(c, info, &dto.Usage{}, nil)
	return nil
}
