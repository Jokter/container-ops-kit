# Ruby 与 Rails 代码检视指南

> 面向 Ruby 3.4+/4.0 和 Rails 8.x，重点关注 Ruby 语义、控制器边界、Active Record 正确性、查询性能、后台作业和测试。

## 目录

- [适用范围与版本意识](#适用范围与版本意识)
- [Ruby 语义与 API 契约](#ruby-语义与-api-契约)
- [集合、修改与 nil](#集合修改与-nil)
- [异常与资源安全](#异常与资源安全)
- [Rails 控制器与安全](#rails-控制器与安全)
- [Active Record 正确性](#active-record-正确性)
- [查询性能](#查询性能)
- [事务与并发](#事务与并发)
- [Active Job 与外部副作用](#active-job-与外部副作用)
- [测试与工具](#测试与工具)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## 适用范围与版本意识

本指南面向仍受维护的 Ruby 3.4/4.0 应用和 Rails 8.x。应用版本专属建议前，先检查 .ruby-version、Gemfile.lock、config.load_defaults、数据库适配器、队列适配器及 CI 测试矩阵。

不要仅因为存在新 API 就要求使用。例如 Rails 8 的 params.expect 是简洁的强参数 API，但已有明确的 require(...).permit(...) 契约仍可能正确。MRI、JRuby、TruffleRuby 的实现细节也不同，不要将 MRI 的全局虚拟机锁当作同步机制的替代品。

检视问题：
- 实际部署了哪些 Ruby、Rails、数据库和队列版本？
- 变更是否依赖不同 Rails 版本或适配器之间存在差异的默认行为？
- 是否将纯升级建议与正确性、安全性问题区分开？

---

## Ruby 语义与 API 契约

### 牢记 Ruby 的真值规则

只有 false 和 nil 为假值。0、空字符串和空数组都为真值，因此从其他语言移植的代码可能静默进入错误分支。

```ruby
# 不佳：零也是真值，因此无法据此判断是否查到记录。
if relation.count
  publish_report
end

# 推荐：直接表达条件，让数据库高效返回结果。
publish_report if relation.exists?
```

检视问题：
- 条件是否错误地依赖 0、空字符串或空集合为假？
- empty?、any?、exists?、present? 或显式比较是否更能表达意图？
- 是否仅为判断记录存在，就加载了整个数据库关系结果？

### 保持谓词与比较契约

谓词方法通常应以 ? 结尾并返回布尔值。仔细检视自定义相等性，==、eql?、equal? 和 hash 的契约各不相同。

```ruby
class Money
  attr_reader :amount, :currency

  def initialize(amount, currency)
    @amount = amount
    @currency = currency
  end

  def ==(other)
    other.is_a?(Money) &&
      amount == other.amount &&
      currency == other.currency
  end

  alias eql? ==

  def hash
    [amount, currency].hash
  end
end
```

检视问题：
- 重写 eql? 后，hash 是否一致，以保证 Hash 和 Set 查找正常？
- 需要值相等时，是否误用了 equal? 身份比较？
- 调用方期望 true/false 时，谓词是否却返回领域对象或 nil？

### 显式声明关键字参数

Ruby 区分位置参数与关键字参数。宽泛的 **options 可能掩盖拼写错误并削弱公共 API 契约。

```ruby
# 不佳：静默接受拼错或不支持的选项。
def charge(customer, **options)
  gateway.charge(customer, options)
end

# 推荐：调用方可明确看到必填和可选关键字参数。
def charge(customer, amount:, currency: "USD", idempotency_key:)
  gateway.charge(
    customer,
    amount: amount,
    currency: currency,
    idempotency_key: idempotency_key
  )
end
```

只有确实要转发全部位置参数、关键字参数和代码块时，才用 ... 进行透明委托。

检视问题：
- 必填关键字是否声明为无默认值？
- 包装方法是否正确保留关键字和代码块？
- 接受任意关键字是否会让调用方拼写错误变成延迟或静默行为？

### 缩小元编程边界

Ruby 很容易构建动态 API，但 eval、字符串形式的 class_eval、send、const_get 和动态常量解析都应视为信任边界。

```ruby
# 不佳：用户输入控制了被调用的方法。
account.send(params[:operation])

# 推荐：将外部输入映射为固定的内部操作。
OPERATIONS = {
  "activate" => :activate!,
  "suspend" => :suspend!
}.freeze

operation = OPERATIONS.fetch(params[:operation])
account.public_send(operation)
```

检视问题：
- 外部输入能否选择方法、类、常量、模板或代码字符串？
- 调用 public_send 或 constantize 之前是否使用固定白名单？
- 元编程是否被隔离，并有契约测试覆盖？

### 将反序列化与 shell 执行视为信任边界

Marshal.load 可以实例化 Ruby 对象，绝不能接收不可信字节。优先使用 JSON 等纯数据格式；必须使用 YAML 时，以明确白名单调用 YAML.safe_load 或 Psych.safe_load。进程参数应分别传入，不要插值拼接 shell 命令。

```ruby
# 不佳：不可信输入可能触发不安全的对象反序列化。
payload = Marshal.load(request.raw_post)

# 推荐：只解析纯数据 JSON 值，再校验结构。
payload = JSON.parse(request.raw_post)

# 推荐：只允许格式实际需要的 YAML 类型和别名。
payload = YAML.safe_load(request.raw_post, permitted_classes: [], aliases: false)

# 不佳：文件名可能注入额外的 shell 语法。
system("convert #{uploaded_path} output.png")

# 更好：argv 形式绕过 shell 解析，但仍需校验路径。
system("convert", uploaded_path, "output.png")
```

检视问题：
- 请求、缓存、Cookie、队列或文件中的数据能否进入 Marshal.load、YAML.load 或不受限制的 Psych.load？
- 解析后的数据在选择类、方法、路径或数据库操作前是否已经校验？
- permitted_classes 和 aliases 是否采用 YAML 契约允许的最严格限制？
- 子进程参数是否分别传递，路径是否限定在预期上传根目录，是否处理退出状态和超时？

---

## 集合、修改与 nil

### 避免共享的可变集合默认值

Hash.new(object) 对每个缺失键复用同一个对象。各键需要独立可变状态时，应使用代码块。

```ruby
# 不佳：所有缺失键共享同一个数组。
grouped = Hash.new([])
grouped[:paid] << 1
grouped[:failed] << 2
# 键从未被赋值，两次读取都修改了同一个隐藏的默认对象。
grouped # => {}
grouped[:paid] # => [1, 2]
grouped[:failed] # => [1, 2]

# 不佳：所有元素都引用同一个数组。
matrix = Array.new(3, [])

# 推荐：代码块为每个元素创建独立数组。
matrix = Array.new(3) { [] }

# 推荐：每个缺失键获得各自独立的数组。
grouped = Hash.new { |hash, key| hash[key] = [] }
grouped[:paid] << 1
grouped[:failed] << 2
```

检视问题：
- Hash 默认值是否包含可变 Array、Hash 或 String？
- 需要保存结果时，默认代码块是否将新值写回哈希？
- 共享常量或类属性是否可能被多个请求或测试修改？

### 感叹号方法是语义提示，并不提供统一保证

Ruby 的 ! 通常表示相对更危险或会修改对象的版本，但并不一律表示失败时抛异常。许多原地修改方法在没有变化时返回 nil。

```ruby
name = "ready"

# 不佳：字符串已经是小写时，`downcase!` 返回 nil。
normalized = name.downcase!

# 推荐：需要返回结果时，使用不带感叹号的形式。
normalized = name.downcase
```

检视问题：
- 是否未核对契约就依赖感叹号方法的返回值？
- 原地修改是否对对象的所有持有者可见？
- 非修改式转换能否让数据流更清晰？

### 不要用安全导航掩盖被破坏的不变量

&. 适合确实可选的关联。反复使用安全导航也可能让必要数据缺失延迟表现为 nil，掩盖无效状态的源头。

```ruby
# 当每个订单都必须关联客户和邮箱时，这种写法不合适。
recipient = order&.customer&.email

# 推荐：强制要求必要关联，在无效状态出现处尽早失败。
recipient = order.customer.email
```

检视问题：
- nil 是否属于合法领域状态，还是不变量被破坏的信号？
- 是否应由模型、数据库或调用方保证存在性？
- dig 或 &. 是否只是暂时隐藏错误，最终在更后面失败？

### 选择符合意图的 Enumerable 操作

each 用于副作用，map 用于转换，filter_map 用于转换并去除空结果，each_with_object 用于累积。热点路径避免产生大量中间数组的调用链。

```ruby
# 不佳：用 map 执行副作用，并产生未使用的数组。
orders.map { |order| AuditLog.write(order) }

# 推荐：明确表达副作用。
orders.each { |order| AuditLog.write(order) }

# 推荐：一次遍历完成转换并丢弃 nil 值。
emails = users.filter_map { |user| user.email if user.subscribed? }
```

检视问题：
- 是否调用 map 却忽略返回集合？
- 长调用链是否分配大型中间集合？
- 数据库尚未筛选、排序或聚合时，是否已把 relation 转为 Array？

---

## 异常与资源安全

### 仅捕获最小范围的预期失败

裸 rescue 捕获 StandardError 及其子类，仍会混合编程错误、数据库错误、超时和校验失败等多种无关异常。

```ruby
# 不佳：将所有普通应用错误都转换成相同响应。
def create
  order = Orders::Create.call(order_params)
  render json: order
rescue => error
  Rails.logger.info(error.message)
  render json: { error: error.message }, status: :internal_server_error
end

# 推荐：在边界转换预期错误，让非预期错误
# 进入集中错误报告流程。
rescue_from Orders::InvalidOrder, with: :render_invalid_order

def create
  order = Orders::Create.call(order_params)
  render json: { id: order.id, status: order.status }, status: :created
end
```

检视问题：
- 被捕获异常是否确实是当前边界预期处理的错误？
- 受保护代码块是否足够小，避免捕获无关缺陷？
- 响应是否暴露内部异常消息、SQL、路径、令牌或供应商细节？

### 保留原始堆栈与原因

使用裸 raise 重新抛出当前异常。raise error 也会重新抛出同一异常对象并保留已有堆栈，但裸 raise 更清晰地表达意图。转换为领域错误时，报告原始异常对象并保留原因链。

```ruby
begin
  gateway.charge(payload)
rescue Gateway::Timeout => error
  Rails.error.report(error, context: { order_id: order.id })
  raise Payments::Unavailable, "payment gateway timed out"
end
```

在 rescue 内抛出新异常，会默认将捕获的异常设为 cause。新建异常，例如 raise Payments::Unavailable, error.message，会产生新堆栈；仅在边界需要领域专属错误时这样做。

各技术栈共享的边界、原因链和报告原则，见[错误处理指南](cross-cutting/error-handling-principles.md)。

检视问题：
- 是否记录安全的结构化上下文，而不包含秘密或完整支付信息？
- 错误是否保留有用的原因链？
- 日志级别是否恰当，错误是否只报告一次？

### 使用代码块或 ensure 清理资源

优先采用代码块形式的资源 API，即使抛异常也会关闭资源。没有代码块形式时使用 ensure。

```ruby
# 推荐：File.open 在代码块结束后关闭句柄。
File.open(path, "rb") do |file|
  checksum(file)
end

connection = pool.checkout
begin
  consume(connection)
ensure
  pool.checkin(connection)
end
```

检视问题：
- 文件、锁、临时目录及借出的资源是否在所有路径释放？
- ensure 是否意外 return，导致异常被压制？
- 重试次数是否有界，并仅针对瞬时失败？

---

## Rails 控制器与安全

### 显式要求并允许参数

Rails 8 的 params.expect 可要求预期形状且仅允许指定属性。较旧且仍受支持的版本使用既有 require(...).permit(...) 约定。

```ruby
# 不佳：将未过滤的控制器参数传入批量赋值边界。
Order.create!(params[:order])

# 不佳：允许当前和未来所有属性，包括敏感列。
params.expect(order: {})

# 推荐：对扁平请求结构使用允许列表。
def order_params
  params.expect(order: [:product_id, :quantity, :shipping_address_id])
end

# 不佳：单层数组无法表达嵌套参数哈希组成的数组。
params.expect(order: [:product_id, line_items_attributes: [:id, :sku, :quantity]])

# 推荐：嵌套资源数组使用双层数组形式。
params.expect(order: [
  :product_id,
  line_items_attributes: [[:id, :sku, :quantity]]
])
```

检视问题：
- user_id、role、paid、admin 等权限敏感字段是否被排除？
- 嵌套资源数组是否采用 [[...]] 形式，而非当作扁平嵌套哈希？
- 嵌套哈希和数组是否严格按预期形状允许？
- permit!、to_unsafe_h 或允许空哈希是否扩大输入契约？

### Active Record 查询参数化

绝不将请求数据插值进 SQL 片段。优先用哈希条件或占位符，排序列等动态标识符采用白名单。

```ruby
# 不佳：SQL 注入。
Order.where("status = '#{params[:status]}'")

# 推荐：哈希条件会被参数化。
Order.where(status: params[:status])

# 推荐：非等值条件使用占位符。
Order.where("total_cents >= ?", params[:minimum_cents])

# 不佳：值虽然已引用，但列名仍由攻击者控制。
Order.order(Arel.sql("#{params[:sort]} DESC"))

# 推荐：将外部值映射到固定的 SQL 标识符。
SORTS = {
  "newest" => { created_at: :desc },
  "total" => { total_cents: :desc }
}.freeze

Order.order(SORTS.fetch(params[:sort], SORTS.fetch("newest")))
```

检视问题：
- 用户输入是否作为字符串进入 where、order、select、joins、having 或 find_by_sql？
- Arel.sql 是否仅用于开发者控制的字面量？
- 动态列名和排序方向是否从白名单选择？

跨 ORM 的参数化和动态标识符模式，见 [SQL 注入防护指南](cross-cutting/sql-injection-prevention.md)。

### 渲染与重定向采用白名单

直接渲染 Active Record 对象，可能在控制器未修改时暴露新增数据库列。使用序列化器或显式字段列表。重定向、文件路径和绕过 HTML 安全处理的操作都属于安全边界。

```ruby
# 不佳：将来新增的列可能直接进入 API 响应。
render json: order

# 推荐：明确指定响应字段，便于版本管理。
render json: {
  id: order.id,
  status: order.status,
  total_cents: order.total_cents
}, status: :created

# 不佳：用户控制目标地址时会形成开放重定向。
redirect_to params[:return_to], allow_other_host: true

# 推荐：重定向到应用内部路由。
redirect_to order_path(order)
```

检视问题：
- 是否序列化了秘密、密码摘要、令牌、内部备注或个人数据？
- html_safe、raw 或 safe_join 是否接收不可信内容？
- 用户输入能否控制外部重定向、下载路径或响应头？

### 区分认证、授权与查询范围

认证确定调用者身份，授权决定其可以做什么。在授权前按全局 ID 读取记录，可能造成不安全直接对象引用（IDOR）。

```ruby
# 不佳：任意已认证用户可能读取其他用户的订单。
order = Order.find(params[:id])

# 推荐：通过已授权的所有者或策略范围限制查询。
order = current_user.orders.find(params[:id])
```

检视问题：
- 每个针对具体资源的操作，包括新增控制器动作，是否都经过授权？
- 更新、删除、下载或加入队列前，记录查询是否限定范围？
- 浏览器会话中的状态变更请求是否有 CSRF 防护？

### 保护基于会话的浏览器请求

浏览器自动发送认证会话 Cookie 时，需要 CSRF 防护。使用显式 Bearer 令牌的纯 API 接口可以采用不同策略，但接口返回 JSON 并不意味着可以安全关闭 CSRF。

```ruby
# 推荐：依赖会话的控制器保持伪造请求防护开启。
class ApplicationController < ActionController::Base
  protect_from_forgery with: :exception
end
```

```ruby
# 推荐：在初始化器中配置会话存储（例如
# config/initializers/session_store.rb），不要放在控制器类内。
# 禁止 JavaScript 读取 Cookie，生产环境仅使用 HTTPS，
# 并根据应用流程明确跨站策略。
Rails.application.config.session_store :cookie_store,
  key: "_app_session",
  secure: Rails.env.production?,
  httponly: true,
  same_site: :lax
```

检视问题：
- 浏览器已认证的 POST、PATCH、PUT、DELETE 是否跳过 protect_from_forgery？
- Cookie 的 secure、httponly、same_site 设置是否适合部署与登录流程？
- 纯 API 接口是否避免 Cookie 认证，或采用明确的 CSRF 防护策略？

### 检视 Active Storage 与服务端抓取

对 Active Storage 上传和服务端 URL 抓取，在接受用户控制的 URL 前检查文件对象所有权、内容类型、大小及 SSRF 防护。签名和过期 URL、直传限制、派生图像参数应受白名单控制。更广泛的请求和资源检视方法见[安全检视指南](security-review-guide.md)。

检视问题：
- 附件下载、重定向或服务端抓取能否访问授权范围外的文件或 URL？
- 持久化或转换文件对象前，是否检查内容类型、大小和所有权？
- 用户控制的抓取 URL 是否执行主机白名单，并阻断私有网络地址范围？

### 让重试写请求具有幂等性

数据库提交后、客户端收到响应前，客户端或代理可能重试。订单创建等操作应要求调用方提供幂等键，将其限定到认证主体与具体操作，并通过数据库保证唯一。

```ruby
# 服务同时存储幂等键与已校验请求的指纹。
order = Orders::CreateOnce.call(
  actor: current_user,
  idempotency_key: request.headers.fetch("Idempotency-Key"),
  attributes: order_params
)

# 迁移：API 要求该请求头时，将对应键设为必填，并防止
# 并发重复创建。已有数据的表需要先回填，
# 或设置临时默认值，再添加 `null: false`。
add_column :orders, :idempotency_key, :string, null: false
add_index :orders, [:user_id, :idempotency_key], unique: true
```

重复使用相同键时，仅当请求指纹一致才返回原结果。键相同但属性不同应拒绝，不能静默返回或修改错误资源。

检视问题：
- 写入提交后是否还可能发生超时或入队失败？
- 调用方是否可能重试创建、支付、邀请或其他非幂等操作？
- 缺少必填幂等键时，是否在插入前拒绝，并将键存于 null: false 列？许多数据库的唯一索引允许多个 NULL。
- 已有表的迁移是否先回填，再设置 null: false？
- 幂等性是否由唯一约束保障，并通过并发请求测试？

---

## Active Record 正确性

### 模型校验与数据库约束配套

模型校验改善错误提示，但无法防范并发写入或非 Rails 客户端。关键不变量需要数据库约束和索引。

```ruby
class Membership < ApplicationRecord
  validates :user_id, uniqueness: { scope: :team_id }
end

# 还需要执行迁移：
add_index :memberships, [:team_id, :user_id], unique: true
add_check_constraint :orders, "total_cents >= 0", name: "orders_total_nonnegative"
```

检视问题：
- 唯一、非空、外键和范围不变量是否在数据库中落实？
- 应用是否处理并发请求触发的约束违规？
- 新查询模式是否有适当索引支持？

### 了解哪些 API 跳过校验和回调

批处理方法很有价值，但 update_all、delete_all、insert_all 和直接 SQL 会绕过普通模型生命周期的部分环节。

```ruby
# 不会运行模型校验或更新回调。
Order.where(expired: true).update_all(status: "cancelled", updated_at: Time.current)
```

检视问题：
- 跳过校验、回调、时间戳、审计和依赖行为是否为有意设计？
- 即使更慢，是否仍需 destroy_all 完成依赖清理？
- 批量写是否绕过计数缓存回调，需 reset_counters 或其他明确校正步骤？
- 批处理是否有界、可观察且可安全重试？

### 回调保持小而可预测

发送邮件、调用 API、触发多条流程或修改无关模型的回调，会让持久化行为难以理解。

优先用显式应用服务组织流程。仅允许事务提交后执行的工作，应明确采用 after_commit 或提交后入队机制。

检视问题：
- 保存模型是否会意外触发网络 I/O 或大范围级联？
- 回调是否可能在测试、数据迁移、控制台脚本或重试中执行？
- 正确性是否依赖未文档化的回调顺序？

### 将枚举与查询作用域变更视为数据契约变更

基于整数的枚举依赖稳定序号映射。新增值应追加或使用显式映射，不要重排已有项。

```ruby
# 更适合长期保存的数据和跨服务约定。
enum :status, {
  pending: 0,
  paid: 1,
  cancelled: 2
}
```

作用域应一致地返回 relation。条件作用域若返回 nil 或 Array，会破坏组合能力。

检视问题：
- 枚举修改是否重新解释了已有数据行？
- 作用域是否对每种输入都能继续链式调用？
- default_scope 是否在意料之外的上下文隐藏记录或改变排序？

### 保持计数缓存与查询缓存正确

计数缓存是由回调维护的冗余数据。批量写、直接 SQL、导入及绕过生命周期的删除可能使它偏离真实值；先验证作为事实依据的查询，再有计划地通过 reset_counters 修复。

长期作业也不应假定查询结果在整个任务期间都最新。检查查询缓存范围，在后续步骤必须观察写入或并发修改时，使用 uncached 块或重新查询。

检视问题：
- update_all、delete_all、导入或直接 SQL 是否绕过计数缓存更新？
- 计数缓存修复是否可观察，并基于当前真实数据？
- 长期作业不同阶段之间，缓存查询结果是否可能过期？

---

## 查询性能

### 检测并避免 N+1 查询

循环中访问关联是重点。根据关联仅用于读取，还是同时用于 SQL 条件，选择预加载方式。

```ruby
# 不佳：先查询订单，再为每个客户单独查询。
orders = Order.where(status: "paid")
orders.each { |order| puts order.customer.name }

# 推荐：通常只需两次查询，对象加载行为明确。
orders = Order.where(status: "paid").preload(:customer)

# 需要 Rails 自动选择预加载策略时适用。
orders = Order.includes(:customer).where(status: "paid")

# 明确需要 LEFT OUTER JOIN 时使用 eager_load。
orders = Order.eager_load(:customer).where(customers: { active: true })
```

strict_loading 可将意外的延迟加载转为开发或测试环境中可见的失败。

支持 eager_load 的 LEFT OUTER JOIN 在关联集合时可能影响结果基数：父记录可能随匹配子项重复出现。调用方要求每个父记录一行时，使用 distinct、子查询，或分离筛选查询与 preload。

跨框架检测与加载策略见 [N+1 查询指南](cross-cutting/n-plus-one-queries.md)。

检视问题：
- 序列化器、视图、GraphQL 解析器或作业是否遍历未加载关联？
- 所选预加载方式是否兼容筛选、排序和结果基数？
- 集合关联是否可能重复父行，需要 distinct、子查询或独立 preload？
- 关键接口是否通过查询次数断言或严格加载保护？

### 将筛选与聚合留在数据库

先加载再筛选既浪费内存，也可能改变语义。

```ruby
# 不佳：加载所有已付款订单后再用 Ruby 过滤。
large_orders = Order.paid.to_a.select { |order| order.total_cents >= 10_000 }

# 推荐：由数据库应用筛选条件。
large_orders = Order.paid.where(total_cents: 10_000..)

# 不佳：只读一列却实例化完整记录。
emails = User.active.map(&:email)

# 推荐：仅读取所需列。
emails = User.active.pluck(:email)
```

检视问题：
- to_a、map、select 或 sort_by 是否过早把工作移到 Ruby？
- pluck、pick、ids、exists?、count、sum 或 maximum 能否避免模型实例化？
- 选取列、SQL 表达式、适配器或自定义属性类型是否保留调用方期望的值类型？
- 查询是否选取了超出需要的列或行？

### 大数据集分批处理，接口分页

大型后台任务使用 find_each 或 in_batches；列表接口采用稳定分页。

```ruby
Order.where(status: "pending").find_each(batch_size: 1_000) do |order|
  Reconciliation.check(order)
end
```

find_each 和 in_batches 基于游标分批，默认使用主键，可能忽略或替换 relation 自定义 ORDER BY。业务顺序重要时，使用当前 Rails 版本支持的显式游标与排序，或专门查询。

检视问题：
- 此查询的数据量是否可能无界增长？
- 分批处理是否与游标、排序和修改行为兼容？
- 分页是否使用确定顺序，以及有索引的游标或键？

### 检视缓存时考虑失效策略

缓存可能掩盖 N+1，同时引入过期数据或跨租户数据泄漏。缓存键必须包含所有影响结果的输入。

检视问题：
- 键是否包含租户、语言地区、授权范围和数据版本？
- 失效是否关联到所有影响缓存值的记录？
- 敏感数据是否可能被返回给其他用户或租户？

---

## 事务与并发

### 事务聚焦于数据库状态

数据库事务无法回滚 HTTP 调用、已送达外部消息系统的消息、文件或支付。

```ruby
# 不佳：数据库事务回滚后，外部支付仍可能成功。
Order.transaction do
  gateway.charge(order.total_cents)
  order.update!(status: "paid")
end

# 更好：配置任务仅在提交后入队，持久化明确的
# 状态转换，并核对幂等的外部操作结果。
class PaymentJob < ApplicationJob
  self.enqueue_after_transaction_commit = true
end

Order.transaction do
  order.update!(status: "payment_pending")
  PaymentJob.perform_later(order)
end
```

不要依赖随版本变化的默认入队行为。Rails 8.0/8.1 应用与队列适配器可能根据 config.load_defaults 和部署拓扑立即入队；较新默认值可能更常延迟，但作业应明确声明自身要求。若入队必须与状态变更一起持久化，采用发件箱或对账补偿路径。

检视问题：
- 哪些副作用真正受事务保护？
- 具体作业类是否声明提交后入队，而非依赖适配器或 Rails 版本默认值？
- 超时可能表示失败，还是已成功但响应丢失？
- 部分完成时是否有恢复或对账路径？

### 不要在已失效事务中吞掉数据库错误

某些适配器，尤其 PostgreSQL，在语句错误后会让事务无法继续使用，直到回滚。应在事务边界之外捕获预期约束错误，或明确重启整个事务。

检视问题：
- 是否在事务内部捕获 ActiveRecord::StatementInvalid 后继续执行 SQL？
- 重试是否仅针对死锁、串行化失败等已知瞬时冲突？
- 重试是否重复外部副作用？

### 保护业务不变量，而不只是给代码路径加锁

Ruby 进程锁无法保护多进程或多主机共享数据。数据库共享不变量应通过唯一约束、原子更新、乐观锁或行锁保护。

```ruby
order.with_lock do
  return if order.paid?

  order.update!(status: "payment_pending")
end
```

检视问题：
- 两个请求能否同时观察同一个旧状态并继续执行？
- 原子条件更新或唯一索引是否比锁更简单？
- 锁顺序是否一致，以避免死锁？

### 有意识地选择乐观锁或悲观锁

普通编辑冲突不多且调用方能重新加载或解决冲突时，使用乐观锁。需要串行访问的小范围关键状态转换，可用 with_lock 等短时悲观锁。

```ruby
# 迁移：Rails 递增此列，并拒绝基于过期版本的更新。
add_column :orders, :lock_version, :integer, default: 0, null: false

begin
  order.update!(shipping_address: new_address)
rescue ActiveRecord::StaleObjectError
  # 重新加载、返回冲突响应，或让用户协调变更。
end
```

检视问题：
- 低竞争用户编辑能否采用 lock_version 和冲突响应，而非持续持有行锁？
- 悲观锁是否仅覆盖最小状态转换，并保持一致加锁顺序？

### 将可变全局状态视为并发状态

类变量、类实例变量、包含可变对象的常量、记忆化结果及单例客户端，可能由请求线程共享。

检视问题：
- 惰性初始化是否线程安全，并能安全应对代码重载？
- 请求专属数据是否放在全局变量、类变量或长期存活的线程局部存储中？
- 库文档是否明确说明共享客户端线程安全？

---

## Active Job 与外部副作用

### 让重试作业具有幂等性

Active Job 或队列后端配置后可能重试作业。外部副作用成功后、本地状态更新前，进程也可能停止。

```ruby
class CapturePaymentJob < ApplicationJob
  self.enqueue_after_transaction_commit = true
  retry_on PaymentGateway::Timeout, wait: :polynomially_longer, attempts: 5

  def perform(order)
    order.with_lock do
      return if order.paid?
      order.update!(status: "payment_processing")
    end

    result = PaymentGateway.capture(
      amount: order.total_cents,
      idempotency_key: "order-#{order.id}-capture"
    )

    order.update!(status: "paid", payment_reference: result.reference)
  end
end
```

网关幂等键、持久化状态和对账流程必须配合。仅凭数据库标记，无法证明外部扣款尚未发生。

检视问题：
- 工作进程在副作用发生后、最终更新前停止会怎样？
- 幂等键是否在重试间保持稳定，并唯一对应预期操作？
- 可重试失败与永久失败是否区别处理？
- 哪些状态为终态、可重试或可恢复状态，卡住的 payment_processing 如何暴露给对账流程？

### 理解 GlobalID 参数

Active Job 可通过 GlobalID 序列化 Active Record 对象，记录在执行时而非入队时加载。若已删除，反序列化会在 perform 前抛出 ActiveJob::DeserializationError。

记录不存在若是预期业务情况，可传 ID，并在作业内窄范围处理 ActiveRecord::RecordNotFound。除非所有反序列化失败都允许丢弃，否则不要一概 discard_on ActiveJob::DeserializationError，它也会隐藏序列化器或部署问题。

检视问题：
- 作业是否有意使用当前记录状态，而非快照？
- 记录被删或不再符合条件时，应如何处理？
- discard_on ActiveJob::DeserializationError 是否会丢掉本应调查的工作？

### 明确入队与事务的边界

记录提交前就执行的作业可能查不到记录。Rails 支持提交后入队，但保证取决于具体作业设置、队列适配器、Rails 加载默认值和数据库拓扑。

检视问题：
- 工作进程能否在创建事务提交前开始执行？
- 代码是否意外依赖作业表与应用共用数据库？
- 数据提交后入队失败，是否有发件箱、重试或对账路径？

### 网络操作设置超时并提供可观察信息

每次外部调用都需要有界的连接、读取和写入超时，结构化错误报告，以及足够的标识来追踪重试，同时避免记录秘密。

检视问题：
- 客户端配置是否显式设置超时？
- 队列延迟、尝试次数、外部请求 ID 和最终结果是否可观察？
- 长期任务是否适当拆成可恢复或带检查点的单元？

---

## 测试与工具

### 在合适边界测试行为

领域规则用模型测试，控制器行为用请求或系统测试，序列化、重试和副作用边界用作业测试。避免仅断言某回调或私有方法被调用。

高价值用例包括：
- 未允许的参数无法修改受保护属性；
- 不安全排序或筛选输入无法改变 SQL 结构；
- 查询前通过授权限定记录范围；
- 序列化器不暴露敏感列；
- 查询次数断言或严格加载使 N+1 回归失败；
- 作业执行两次仍安全；
- 有意处理 GlobalID 记录删除和网关永久失败；
- 外部副作用成功后的超时，可通过对账恢复且不重复执行。

### 时间与异步测试保持确定性

使用 Rails 时间辅助工具，不依赖真实休眠。通过测试适配器或后端专属集成测试执行作业，并按需要分别断言入队行为和实际执行行为。

```ruby
travel_to(Time.zone.local(2026, 7, 14, 10, 0, 0)) do
  assert_enqueued_with(job: ExpireOrderJob, at: 30.minutes.from_now) do
    order.schedule_expiration!
  end
end
```

检视问题：
- 测试是否依赖真实时钟、全局执行顺序或之前创建的数据？
- 是否在清晰的适配器边界替换外部服务？
- 并行测试是否共享可变常量、文件、端口或非事务状态？

### 执行项目实际配置的检查

常见命令包括：

```bash
bundle exec ruby -wc path/to/file.rb
bundle exec rubocop
bundle exec brakeman -q
bundle exec rails test
bundle exec rspec
```

只运行仓库中实际具备的工具；先检查配置，不要把风格或复杂度阈值当作通用规则。Brakeman 和依赖扫描器的安全发现需要人工核实，不能盲目忽略。

---

## 检视清单

### Ruby 语义
- [ ] 条件符合 Ruby 真值规则，0、空字符串和空数组都为真。
- [ ] 相等性和 hash 契约一致。
- [ ] 关键字参数及转发保留预期 API 契约。
- [ ] 动态方法或常量查找使用白名单。
- [ ] 可变 Hash/Array 默认值、常量及类状态没有被意外共享。
- [ ] 不可信数据不进入不安全反序列化或插值 shell 命令。
- [ ] 已理解感叹号方法和安全导航的返回语义。

### 异常与资源
- [ ] rescue 在窄边界处理具体预期失败。
- [ ] 意外错误保留原因和堆栈。
- [ ] 客户端响应不暴露内部异常消息。
- [ ] 日志包含安全的结构化上下文和异常对象。
- [ ] 所有路径释放资源和锁。
- [ ] 重试有界，不重复非幂等工作。

### 控制器与安全
- [ ] 强参数使用精确白名单，不使用 permit! 或不安全哈希转换。
- [ ] 嵌套资源数组用 params.expect(...: [[...]]) 表达预期形状。
- [ ] SQL 值参数化，动态标识符使用白名单。
- [ ] 同时具备认证、授权和记录范围限制。
- [ ] 未限定范围的 Model.find(params[:id]) 无法绕过所有权或策略检查。
- [ ] 必要时，重试写请求采用限定范围的幂等键和数据库唯一约束。
- [ ] 显式指定序列化字段并排除敏感数据。
- [ ] 重定向、HTML 安全绕过、文件和响应头不盲目信任输入，不允许开放重定向。
- [ ] 浏览器状态变更请求有 CSRF 防护，Cookie 的 secure、httponly、same_site 设置明确。
- [ ] Active Storage 上传及服务端 URL 抓取校验所有权、内容和 SSRF 边界。

### Active Record
- [ ] 关键模型校验有数据库约束和索引支持。
- [ ] 批量 API 已考虑被跳过的回调、校验和时间戳。
- [ ] 批量写不会静默使计数缓存失真，修复与对账明确。
- [ ] 回调小而清晰，不隐藏流程编排或网络副作用。
- [ ] 枚举映射保持已有持久化值的含义。
- [ ] 作用域始终返回 relation，并对所有输入可组合。
- [ ] 并发不变量通过约束、原子更新、乐观锁或短时数据库锁保护。

### 查询与性能
- [ ] 循环访问的关联已预加载，或有明确依据。
- [ ] includes、preload、eager_load 与查询语义一致。
- [ ] 集合关联不会在未察觉时重复父行或改变基数。
- [ ] 筛选、排序、聚合和存在性检查留在数据库中。
- [ ] 大数据集分批处理，列表接口按稳定顺序分页。
- [ ] 新筛选、关联和排序模式有索引支持。
- [ ] 缓存键按需要包含租户、授权、语言地区和数据版本。

### 作业与外部服务
- [ ] 重试、重复投递和工作进程中断时，作业仍安全。
- [ ] 外部服务支持时使用稳定幂等键。
- [ ] GlobalID 删除、旧状态与当前状态语义均经过设计，预期缺失窄范围处理。
- [ ] 作业明确声明入队时机，不意外依赖队列或数据库拓扑及版本默认值。
- [ ] 部分完成具有对账、补偿或发件箱路径。
- [ ] 终态、可重试状态和卡住的处理中状态可观察，并具有相应恢复处理。
- [ ] 网络调用有超时、可观察信息及不会泄密的日志。

### 测试与自动化
- [ ] 请求测试覆盖参数过滤、授权、状态码及响应字段。
- [ ] 查询次数或严格加载测试保护性能敏感路径。
- [ ] 作业测试覆盖重试、重复执行、删除及部分失败。
- [ ] 时间相关测试使用确定性的 Rails 时间辅助工具。
- [ ] 仓库配置的 Ruby、Rails、静态检查、测试和安全检查通过。

---

## 参考资料

- [Ruby 发行版本](https://www.ruby-lang.org/en/downloads/releases/)
- [Ruby 语法：方法与参数](https://ruby-doc.org/3.4/syntax/methods_rdoc.html)
- [Ruby 语法：异常](https://ruby-doc.org/3.4/syntax/exceptions_rdoc.html)
- [Rails Action Controller 概览](https://guides.rubyonrails.org/action_controller_overview.html)
- [Rails Active Record 查询接口](https://guides.rubyonrails.org/active_record_querying.html)
- [Rails Active Record 事务](https://api.rubyonrails.org/classes/ActiveRecord/Transactions/ClassMethods.html)
- [Rails Active Job 基础](https://guides.rubyonrails.org/active_job_basics.html)
- [保护 Rails 应用](https://guides.rubyonrails.org/security.html)
- [测试 Rails 应用](https://guides.rubyonrails.org/testing.html)
- [RuboCop 文档](https://docs.rubocop.org/rubocop/)
- [RuboCop Rails 文档](https://docs.rubocop.org/rubocop-rails/)
- [Brakeman 安全扫描器](https://brakemanscanner.org/)
