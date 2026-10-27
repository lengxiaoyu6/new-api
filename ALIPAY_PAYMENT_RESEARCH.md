# 支付宝经营码账单收款接入调查

调查日期：2026-10-27。

核查对象为 PerPay `main` 提交 `24934512c2a862ac0aa383b8d9e535275a4f6a13`，提交时间为 2026-10-26；本项目基于 `1de2debbaf618bd45d594bd2f2219b27ee6ba72e` 检查。这里的版本标识指源码快照，发布版本的接口需另行核对。调查阶段的设计及资料记录如下，实施与验证记录见末节。没有操作真实账户。

## 可行性

可以在本项目的充值模块接入该方案。建议增加独立的 PerPay 支付适配器，由独立部署的 PerPay 处理经营码、账单采集、金额分配和异常账务，本项目负责充值订单、收款通知验证和余额入账。

PerPay 当前快照采用自定义 HMAC 协议，本项目现有充值采用易支付协议，两者的下单接口、签名和通知格式均有差异。仅修改现有易支付服务地址无法完成接入。[P1][L1]

如果要求全部功能随本项目运行，则还需在 Go 后端实现账单采集、付款匹配、金额占用与冷却、补查、异常处理和管理界面，实施范围明显大于支付适配器。这是根据 PerPay 模块及当前项目支付结构作出的工程判断。[P2][P3][P4][L1][L2]

## 工作机制

1. 管理员配置同一收款账户的支付宝经营码及开放平台应用。
2. 业务系统创建订单，PerPay 分配唯一的应付金额；源码从标价加 1 分开始，选择允许加价范围内满足占用和冷却条件的最小金额。
3. 收银台展示经营码与应付金额。公开收银台使用已配置的收款码内容，业务订单号没有通过该过程绑定到支付宝交易。
4. PerPay 定时调用支付宝账务明细查询接口，验证响应签名并保存、规范化流水。
5. 按收款账户、币种、收入方向、金额和实际付款时间寻找唯一候选订单；无候选、多个候选及重复收款等情况进入异常处理。
6. 确认收款后向业务系统发送签名通知，业务系统验证并完成充值。[P1][P2][P3][P4]

例如两个标价 10.00 元的订单，可以分别分配 10.01 元和 10.02 元。收款账户出现相应时间窗口内的 10.02 元收入时，系统据此推断第二笔订单付款。这里的对应关系来自金额和时间；支付宝账务流水中的交易编号用于保存证据及去重，不能证明业务订单归属。[P3][P4]

备注会作为业务订单信息保存，但自动匹配查询没有使用备注作为订单识别条件。因此不能假设付款备注能够代替金额分配。[P1][P4]

## 支付宝接口和账户条件

具体接口为：

```text
GET https://openapi.alipay.com/v3/alipay/data/bill/accountlog/query
API name: alipay.data.bill.accountlog.query
```

支付宝官方 SDK 将其描述为商家账户账务明细查询，用于获取账户账务流水。PerPay 以时间范围和页码分页查询；请求使用应用私钥进行 RSA-SHA256 签名，响应使用支付宝公钥验证。实现采用官方开放平台接口，没有依赖商家网页 Cookie 或手机通知监听。[A1][P2]

所需配置至少包括收款码、应用 App ID、应用私钥和支付宝公钥。官方 SDK 同时说明了公钥模式与证书模式；PerPay 配置教程采用普通密钥模式。不能把应用私钥、支付宝公钥、PerPay API 密钥和 PerPay 通知密钥混用。[A1][P1][P5]

PerPay 配置教程称账户默认具有账务明细查询权限，并介绍创建网页应用的方法。这属于项目说明。实际账户的准入条件、应用状态要求和经营码收入是否能通过该接口查询，本次没有真实账户证据；官方 SDK 文档本身也没有提供“任意个人账户均可查询”的保证。[A1][P5]

官方 SDK 自动生成文档中的 `No authorization required` 不能解释为匿名查账：同一页面示例配置了 `AppId`、`PrivateKey` 和 `AlipayPublicKey`，PerPay 实现也确实执行请求签名与响应验签。[A1][P2]

## 实际限制

| 项目 | 核查结果 |
| --- | --- |
| 到账确认延迟 | 新配置默认常规查询间隔 60 秒，存在待付款订单时 8 秒，并默认查询 10 秒前的流水；还受支付宝记录可见时间、分页和失败退避影响，不能把 8 秒视为到账承诺。 |
| 付款金额 | 付款者需要按照收银台分配的应付金额支付。错付、重复付款和无法唯一匹配的流水需要人工处理。 |
| 金额复用 | 默认在订单结束后冷却 600 秒再复用。该措施可以减少迟付混淆，但金额再次分配后的极晚付款仍可能归入新订单。 |
| 并发容量 | 相同及相邻标价共享有限金额空间。文档举例：99 种金额、5 分钟付款有效期和 10 分钟冷却，理想持续容量约 6.6 单每分钟；这不是每个实例的固定上限。 |
| 付款截止 | 有效期内付款、较晚查询到的流水仍可处理；订单关闭或过期后才实际付款，不自动补认原订单。 |
| 退款和撤销 | 新的管理员退款标记只记录外部退款声明，不执行支付宝退款，也不通知业务系统；撤销收款关联会产生争议状态，需要业务侧明确处理方式。 |

上述限制来自 PerPay 接入说明和金额匹配实现。即使账务接口返回真实收入，业务订单归属仍是金额和时间推断。[P1][P3][P4][P6]

## 与本项目的衔接

当前项目的主要位置如下：

| 位置 | 现有能力 | 增加 PerPay 时的用途 |
| --- | --- | --- |
| `controller/topup.go` | 计算充值价格，创建 `TopUp`，生成易支付表单；通知验签后调用充值事务。 | 增加 PerPay 下单入口与通知接收，复用现有充值金额和余额上限校验。 |
| `model/topup.go` | `TopUp` 保存充值数量、支付金额、订单号、支付提供方和状态；`RechargeEpay` 在事务内校验订单并入账。 | 增加支付提供方和外部订单关联，复用事务内状态校验及余额入账能力。 |
| `web/src/features/wallet/hooks/use-payment.ts` | Stripe 使用付款链接，普通易支付使用浏览器表单。 | 增加 PerPay 付款分发，打开返回的收银台链接。 |
| `controller/subscription_payment_epay.go` | 订阅使用独立订单，支付通知经验证后开通权益。 | 如果纳入订阅购买，还需单独接入订阅订单处理。 |

这些判断基于本地源码检查；表中的 PerPay 行为均为拟议修改。[L1][L2][L3][L4]

`RechargeEpay` 当前要求 `PaymentProviderEpay`，不能将 PerPay 订单标记为独立提供方后仍原样调用该方法。实施时应增加适配入口，或提取保留支付提供方校验的公共充值事务；继续保证订单状态变更与余额增加处于同一事务。[L2]

### 建议的适配过程

1. 服务端创建本地待支付订单，使用固定业务订单号与幂等键调用 `POST /api/v1/orders`。
2. 将本地订单号传入 `merchant_order_no`，将人民币金额转换为整数分传入 `amount_cents`，保存 PerPay 订单号及收银台链接。
3. 分别记录充值额度、原标价、分配的应付金额和实收金额，避免把用于区分订单的加价误当成充值额度或现有折扣。
4. 浏览器打开 `checkout.checkout_url`。
5. 后端接收签名 JSON 通知，读取原始正文验签，检查时间、事件编号及订单关联；API 时间戳使用 Unix 秒，通知时间戳使用 Unix 毫秒。
6. 收到付款确认后使用服务端查单，核对商户订单号、PerPay 订单号、币种、标价、应付金额和实收金额，再依据本地订单约定增加余额。通知示例本身没有金额字段；服务端查单用于取得核对依据。
7. 在数据库中按事件编号去重，以订单状态保证余额只增加一次，并保存订单版本以处理乱序通知。确认提交后返回 PerPay 要求的 JSON ACK。
8. 收银台返回后主动查单；通知丢失可由服务端补查处理。争议通知须保留处理记录和待核查状态，不能被旧的付款通知覆盖。[P1][L1][L2]

这里的步骤记录调查阶段的接入设计，具体实施见末节。接口和通知约束来自 PerPay，充值幂等及金额校验要求来自本项目现有实现。[P1][L1][L2]

PerPay 的 API 请求使用客户端 ID、API 密钥及 HMAC-SHA256；通知使用独立密钥。成功 ACK 包含 `schema: perpay:webhook-ack:v1`、`ack: true`、`event_id` 和 `delivery_id`。这些内容与易支付 MD5 表单、`TRADE_SUCCESS` 和纯文本 `success` 不兼容。[P1][L1]

## 验证范围

本次执行了公开源码及官方 SDK 文档检查，确认了接口名称、签名机制、金额匹配条件、查询参数默认值和两种协议的差异。

实际启用前仍须用目标收款账户完成只读查询，并以小额付款确认经营码流水可见性和时间字段。之后验证正常充值、重复及乱序通知、超时补查、错付金额、迟付、金额冷却和争议状态。

适配涉及订单数据模型和入账事务，真实 SQLite、MySQL 和 PostgreSQL 的本地验证记录见末节。真实支付测试等待 PerPay 部署。

PerPay 采用 MIT 许可证。若复制源码，应保留相应版权和许可说明。[P7]

## 资料

- [A1] [支付宝官方 .NET V3 SDK：商家账户账务明细查询](https://github.com/alipay/alipay-sdk-net-all/blob/master/v3/docs/AlipayDataBillAccountlogApi.md)，2026-10-27 读取。
- [P1] [PerPay 接入说明：请求签名、订单、通知和金额规则](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/USAGE.md)。
- [P2] [PerPay 支付宝请求](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/infrastructure/alipay/provider.ts)、[V3 签名与验签](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/infrastructure/alipay/v3.ts)、[接口常量](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/infrastructure/alipay/types.ts)。
- [P3] [PerPay 订单及金额分配](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/database/order-store.ts)、[收银台收款码投影](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/orders/service.ts)。
- [P4] [PerPay 流水匹配与收款确认](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/reconciliation/store.ts)。
- [P5] [PerPay 支付宝配置教程](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/docs/alipay-setup.md)。
- [P6] [PerPay 查询参数默认值](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/src/shared/provider-defaults.ts)。
- [P7] [PerPay MIT 许可证](https://github.com/Mashiro0619/PerPay/blob/24934512c2a862ac0aa383b8d9e535275a4f6a13/LICENSE)。
- [L1] 本地 `controller/topup.go:138`、`controller/topup.go:297`、`controller/topup.go:421`；依赖 `github.com/Calcium-Ion/go-epay v0.0.5` 的 `epay/order.go`。
- [L2] 本地 `model/topup.go:16`、`model/topup.go:178`。
- [L3] 本地 `web/src/features/wallet/hooks/use-payment.ts:114`、`web/src/features/wallet/lib/payment.ts:62`。
- [L4] 本地 `controller/subscription_payment_epay.go:24`、`controller/subscription_payment_epay.go:118`。

## 适配实施与验证

实施范围为钱包充值。后台支付设置增加 PerPay 页签，配置启用开关、服务地址、客户端 ID、API 密钥和通知密钥。钱包显示支付宝付款按钮并打开 PerPay 收银台，使用通用充值价格、分组倍率和折扣。订阅购买仍使用原有支付提供方。

下单请求使用人民币整数分，并在本地保存业务订单号、幂等键和完整请求正文。遇到不确定的请求结果时，补查复用原请求。通知验签后必须查单，核对订单关联、币种、标价、应付及实收金额；事务同时保存事件和订单状态并增加钱包额度。金额识别加价计入实收金额，充值数量保持本地订单约定。

通知支持持久化事件去重和订单版本检查。争议及旧版退款状态保留为待核查记录，不自动扣除钱包额度。停用新付款后继续处理存量订单通知；主节点每分钟补查最近 48 小时的订单，每批最多 50 条。

安全设计参考 OWASP Authentication Cheat Sheet、Session Management Cheat Sheet、REST Security Cheat Sheet，以及 ASVS 5.0.0 的逐条消息签名要求 4.1.5。适配使用独立的 API 和通知密钥；HTTP 仅允许回环地址，API 请求不跟随重定向。通知在原始正文上验签并检查五分钟时间窗口，日志排除密钥及完整请求内容，主动查单接口校验订单所属账户。这些检查不构成整站 ASVS 合规声明。

2026-10-27 执行的验证：

| 检查 | 结果 |
| --- | --- |
| Go 完整编译 | `GOCACHE=/tmp/new-api-perpay-go-build go build -o /tmp/new-api-perpay-verify .` 通过 |
| 通知和三种数据库测试 | 下方命令通过，涵盖金额不符、钱包上限时事务回滚、事件去重、乱序状态、请求超时补查及订单归属检查 |
| SQLite | 3.50.4；新建与升级场景通过 |
| MySQL | 8.0.46-0ubuntu0.22.04.4；新建与升级场景通过 |
| PostgreSQL | 14.24；新建与升级场景通过 |
| 升级基线 | 按 `v1.0.0-rc.47` 的充值表定义创建代表性历史订单；每个场景连续执行两次 `model.InitDB()`，验证历史金额及订单号唯一约束保留 |
| 前端测试 | 六个测试文件、31 个测试通过 |
| 前端类型与构建 | `bun run typecheck`、`bun run build` 通过 |
| 修改文件检查 | 16 个 TypeScript 文件的 lint 和保留版权头的格式检查通过，`git diff --check` 通过 |
| 全量前端 lint | 因未修改文件中的既有错误未通过，例如 `src/lib/utils.ts` 的 `prefer-string-replace-all` |

```bash
GOCACHE=/tmp/new-api-perpay-go-build \
TEST_MYSQL_DSN='root@tcp(127.0.0.1:13316)/mysql?charset=utf8mb4&parseTime=True&loc=Local' \
TEST_POSTGRES_DSN='postgres://postgres@127.0.0.1:13317/postgres?sslmode=disable&client_encoding=UTF8' \
go test ./controller -run '^TestPerPay' -count=1 -v
```

上述地址属于本次隔离测试实例。充值相关回归另执行 `go test ./controller ./model ./service ./setting -run 'TestPerPay|TestPaymentWebhook|TestTopUp|TestTopup|TestRecharge|TestPaymentMethod' -count=1 -v`，使用相同数据库环境变量，通过。

PerPay 部署后，后台配置上述四项连接信息并启用付款。PerPay 的通知来源和返回来源均应配置为本项目的回调地址或服务器地址；通知接收接口为 `/api/perpay/webhook`，浏览器返回接口为 `/api/perpay/return`。API 和通知密钥必须分别填写，通常为无填充的 43 位 base64url 字符串。公网服务地址要求 HTTPS。

剩余验证为目标部署版本的接口兼容性、真实经营码流水可见性及小额付款到账测试，等待 PerPay 部署。
