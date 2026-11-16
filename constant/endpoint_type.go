package constant

import "github.com/QuantumNous/new-api/relaykit/types"

// EndpointType moved to types with the conversion kit; aliases keep host
// code compiling unchanged.
type EndpointType = types.EndpointType

const (
	EndpointTypeOpenAI                = types.EndpointTypeOpenAI
	EndpointTypeOpenAIResponse        = types.EndpointTypeOpenAIResponse
	EndpointTypeOpenAIResponseCompact = types.EndpointTypeOpenAIResponseCompact
	EndpointTypeOpenAIAlphaSearch     = types.EndpointTypeOpenAIAlphaSearch
	EndpointTypeDeepSeekToolsSearch   = types.EndpointTypeDeepSeekToolsSearch
	EndpointTypeDeepSeekToolsFetch    = types.EndpointTypeDeepSeekToolsFetch
	EndpointTypeDeepSeekToolsOCR      = types.EndpointTypeDeepSeekToolsOCR
	EndpointTypeDeepSeekToolsTTS      = types.EndpointTypeDeepSeekToolsTTS
	EndpointTypeAnthropic             = types.EndpointTypeAnthropic
	EndpointTypeGemini                = types.EndpointTypeGemini
	EndpointTypeJinaRerank            = types.EndpointTypeJinaRerank
	EndpointTypeImageGeneration       = types.EndpointTypeImageGeneration
	EndpointTypeEmbeddings            = types.EndpointTypeEmbeddings
	EndpointTypeOpenAIVideo           = types.EndpointTypeOpenAIVideo
)

// Model names the distributor assigns to the DeepSeek tool endpoints,
// whose bodies carry no model. Channels serve the endpoints by listing them.
const (
	DeepSeekSearchModel = "deepseek-search"
	DeepSeekFetchModel  = "deepseek-fetch"
	DeepSeekOCRModel    = "deepseek-ocr"
	DeepSeekTTSModel    = "deepseek-tts"
)
