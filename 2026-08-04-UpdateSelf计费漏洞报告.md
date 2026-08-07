# UpdateSelf 计费丢失更新漏洞报告

- **报告日期**：2026-08-04
- **漏洞类型**：竞态条件 / 丢失更新（Lost Update Race Condition）→ 计费绕过
- **严重等级**：高危（可直接造成资金损失，且可兼作 DoS 放大器）
- **影响组件**：`PUT /api/user/self`（用户自助修改资料接口）
- **状态**：生产环境已确认被利用，损失约 ¥9,200

---

## 1. 漏洞摘要

用户自助修改资料接口 `PUT /api/user/self` 的「侧边栏设置」与「语言偏好」两个分支，在保存时会将用户记录**全行写回**数据库（包含 `quota`、`used_quota`、`request_count` 等计费字段），而写入值取自请求开始时的快照。

高并发调用该接口时，快照写回会覆盖掉两次调用之间计费系统对额度的**原子自增**，导致用户的 `used_quota` 被回滚——**消费不计账，余额用不完**。

## 2. 根因分析

### 2.1 触发路径

`controller/user.go` `UpdateSelf()`：

```go
// 分支一：sidebar_modules（743-768 行）
// 分支二：language（771-796 行）
user, err := model.GetUserById(userId, false)   // T0 时刻读出完整用户（含 quota/used_quota）
currentSetting := user.GetSetting()
currentSetting.SidebarModules = sidebarModulesStr // 或 currentSetting.Language = langStr
user.SetSetting(currentSetting)
if err := user.Update(false); err != nil { ... }  // ← 危险调用
```

### 2.2 全行写回

`model/user.go` `Update()`（507-523 行）：

```go
newUser := *user                     // T0 时刻的快照（含旧的 quota/used_quota）
DB.First(&user, user.Id)
if err = DB.Model(user).Updates(newUser).Error; ...  // GORM 结构体 Updates：写回所有非零字段
```

GORM 对结构体执行 `Updates` 时会写入**所有非零字段**。`newUser` 是从数据库读出的完整对象，`quota`、`used_quota`、`request_count` 全部非零，因此一并被写回——值却是 T0 时刻的旧值。

### 2.3 竞态时序

```
请求A (PUT /self):  T0 读取行 (quota=Q0, used=U0)
计费系统 (并发):     T0+Δ 原子自增 used_quota = U0 + N  ← model/user.go:1007，安全
请求A (行锁排队后):  T1 全行写回 (quota=Q0, used=U0)     ← N 被抹掉
```

计费侧使用原子自增（`used_quota = used_quota + ?`，`model/user.go:1006-1022`），本身无竞态；问题完全出在 `User.Update()` 的全行覆盖写。

### 2.4 为什么第三分支（改昵称/密码）不受影响

该分支构造的 `cleanUser` 仅含 `Id/Username/Password/DisplayName` 四个字段，其余字段为零值，GORM 结构体 `Updates` 跳过零值字段，因此不触碰计费字段。

## 3. 生产环境利用证据（2026-08-04）

### 3.1 利用方式

攻击者使用住宅代理 botnet（单秒数十个不同 IP）对两个自有账号高并发调用 `PUT /api/user/self`，每个请求因行锁排队约 1.1 秒，写回 1.1 秒前的额度快照，持续回滚 `used_quota`。

### 3.2 直接证据

- 应用日志中 `used_quota` 出现**逆向跳变**（14287934 → 14257374），`request_count` 在 985↔986 间回跳——正确系统中两者均应单调递增；
- 载荷证据：uid 7670 的 `sidebar_modules` 被写入 1500 个 "A"（垃圾载荷，仅为触发写操作）。

### 3.3 损失（无订阅、无管理员赠额，纯钱包用户）

| 账号 | 累计充值 | 真实消费（日志合计） | 账面 used_quota | 损失 |
|---|---|---|---|---|
| 7670 wang2333（07-11 注册） | ¥186 | ¥8,197 | ¥243 | **≈¥7,954** |
| 8150 xun151992（07-29 注册） | ¥40 | ¥1,298 | ¥28.6 | **≈¥1,270** |

全员对账（今日消费 Top30）确认无其他蓄意利用者；其余账号差异均在 ±¥26 以内（正常用户偶发改设置踩中同一竞态的自然损耗）。

### 3.4 附带 DoS 效果

每个请求持有数据库连接约 1.1 秒并排队行锁，高并发下耗尽连接池，全站 SQL 出现大量 `SLOW SQL >= 200ms`，形成应用层 DoS。

## 4. 影响评估

- **资金损失**：消费不计账，已确认约 ¥9,200；漏洞自 2026-07-11 起即被利用（约 3 周）；
- **账务完整性**：`used_quota`、`request_count` 统计失真，全员存在 ±¥25 量级的自然竞态噪音；
- **可用性**：可被用作低成本 DoS；
- **受影响版本**：所有包含当前 `UpdateSelf` + `User.Update()` 实现的部署。

## 5. 检测方法

对账公式：`SUM(logs.quota WHERE type=2 AND user_id=X)` 应约等于 `users.used_quota`。差异显著为正（日志合计 ≫ 账面）即为被回滚账号。

## 6. 处置与修复

### 6.1 已完成（应急处置）

- nginx 层拦截 `PUT /api/user/self` 的非 GET 方法（`limit_except GET { deny all; }`），即刻止血；
- 封禁攻击账号 7670 / 8150（其 API 令牌随缓存过期自动失效）。

### 6.2 代码修复（已实施，2026-08-04）

- `model/user.go` 新增 `UpdateUserSettingColumn()` / `UpdateUserAccessTokenColumn()`（单列写入 + 缓存字段级同步）；
- 5 个用户可高频触发的全行写回点已全部改为单列写入：`PUT /api/user/self`（侧边栏/语言）、`PUT /api/user/self/setting`（通知设置）、账单偏好切换、`GET /api/user/self/token`；
- 修复后经审查确认：DB 层与 Redis 缓存层均不再触碰计费字段，计费读写链路（缓存预扣 + DB 原子自增）未受影响。

### 6.3 账务修复（可选）

对被封禁账号按 `SUM(logs.quota)` 重算 `used_quota` 以修正报表；普通用户的零钱级差异不做追溯。

## 7. 同类风险排查建议

- 全局审查 `DB.Save(x)` / `Updates(结构体)` 的调用点，凡对象字段包含计费/余额列的，均存在同类丢失更新风险；
- `User.Edit()` 已使用 map 显式列（相对安全），但包含 `quota` 列，仅限管理员调用，风险可控；
- 长期建议：计费字段与资料字段的写入路径彻底分离，资料更新一律使用显式列更新。

---

*本报告为 2026-08-04 安全事件（渠道密钥窃取 + 计费漏洞利用）的组成部分。*
