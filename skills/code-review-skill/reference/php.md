# PHP 代码检视指南

> 面向 PHP 8.x，涵盖类型系统、现代语言特性、面向对象建模、PDO 数据访问、安全、错误处理、Composer 依赖、性能与测试。

## 目录

- [快速检视清单](#快速检视清单)
- [类型系统与现代 PHP](#类型系统与现代-php)
- [对象建模](#对象建模)
- [输入、输出与安全](#输入输出与安全)
- [数据库访问](#数据库访问)
- [错误处理](#错误处理)
- [Composer 与依赖](#composer-与依赖)
- [性能与资源管理](#性能与资源管理)
- [测试与静态分析](#测试与静态分析)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## 快速检视清单

### 必查项目

- [ ] 新文件启用 `declare(strict_types=1);`
- [ ] 公共 API 的参数、返回值和属性均声明类型
- [ ] 已校验用户输入，按输出上下文转义
- [ ] SQL 使用参数化查询或 ORM 参数绑定
- [ ] 密码使用 `password_hash()` / `password_verify()`
- [ ] 文件上传校验 MIME、大小、扩展名及存储路径
- [ ] 已提交 `composer.lock`，依赖版本范围合理
- [ ] 具备 PHPUnit/Pest 测试及 PHPStan/Psalm 静态分析

### 常见问题

- [ ] 宽松比较 `==` / `!=` 导致类型转换漏洞
- [ ] 使用 `md5()` / `sha1()` 存储密码
- [ ] 拼接 SQL、HTML、shell 命令或文件路径
- [ ] 使用 `@` 抑制错误
- [ ] 对不可信数据调用 `unserialize()`
- [ ] `$_GET` / `$_POST` / `$_FILES` 直接进入业务逻辑
- [ ] PHP 8.2+ 动态属性触发弃用提示，PHP 9 可能将其视为错误

---

## 类型系统与现代 PHP

### strict_types 与显式类型

```php
<?php

// ❌ 边界约束薄弱：传入 "42" 会被静默转换
function findUser($id) {
    return User::find($id);
}

// ✅ 在文件顶部启用 strict_types，并为公开 API 声明类型
declare(strict_types=1);

function findUser(int $id): ?User
{
    return User::find($id);
}
```

不要完全依赖运行时输入校验来完成类型检查。类型声明表达内部契约，输入校验界定边界上的信任程度，两者都需要。

### 避免宽松比较

```php
<?php

// ❌ 宽松比较可能将 "0e12345" 等字符串视为 0
if ($providedHash == $storedHash) {
    grantAccess();
}

// ✅ 使用严格比较，秘密信息或令牌使用 hash_equals()
if (hash_equals($storedHash, $providedHash)) {
    grantAccess();
}

// ✅ match 使用严格相等检查，比 switch 更少出现类型转换意外
$status = match ($code) {
    200 => 'ok',
    404 => 'not_found',
    default => 'unknown',
};
```

重点检查认证、支付、状态机和权限逻辑中的 `==`、`!=` 以及默认宽松比较的 `in_array($x, $list)`。关键场景使用 `===`、`!==` 和 `in_array($x, $list, true)`。

### 联合类型、交集类型与可空类型

```php
<?php

// ❌ mixed 或无类型声明让调用方只能猜测返回结构
function loadConfig($source) {
    return parseConfig($source);
}

// ✅ 用类型表达真实接口约定
function loadConfig(string|PathInfo $source): Config
{
    return parseConfig($source);
}

// ✅ 空值属于真实业务状态时，显式声明 null
function currentUser(): ?User
{
    return Auth::user();
}
```

`mixed` 可以出现在系统边界或旧代码迁移中，但在核心业务服务中通常意味着建模不足。

### 空安全运算符不应掩盖缺失的必要状态

```php
<?php

// ❌ 链式空安全访问会掩盖失败原因
$country = $order?->customer?->profile?->country;

// ✅ 对关键业务状态显式分支处理
if ($order === null) {
    throw new OrderNotFound();
}

$customer = $order->customer();
if ($customer === null) {
    throw new MissingCustomer($order->id);
}

$country = $customer->profile()?->country;
```

区分“可选展示字段”与“必须存在的业务不变量”。前者适合 `?->`，后者缺失时应明确报错。

---

## 对象建模

### 使用 readonly 属性和值对象

```php
<?php

// ❌ 公开可变字段允许调用方随意修改状态
class Money
{
    public $amount;
    public $currency;
}

// ✅ 使用类型和 readonly 表达不可变值对象
final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {
        if ($amount < 0) {
            throw new InvalidArgumentException('Amount must be non-negative');
        }
    }
}
```

对于 DTO、配置和领域值对象，先检查能否通过 `readonly class` 或只读属性消除隐藏副作用。

### 使用枚举替代字符串状态

```php
<?php

// ❌ 字符串状态容易拼错，也无法列出全部合法状态
if ($order->status === 'paied') {
    ship($order);
}

// ✅ 使用枚举更早暴露非法状态
enum OrderStatus: string
{
    case Pending = 'pending';
    case Paid = 'paid';
    case Cancelled = 'cancelled';
}

if ($order->status === OrderStatus::Paid) {
    ship($order);
}
```

检视状态机、权限或类型字段时，留意魔法字符串。值集合稳定时建议使用枚举；若来自外部系统，在进入业务层前转换为内部枚举。

### 不要依赖动态属性

```php
<?php

// ❌ PHP 8.2+ 创建动态属性时会产生弃用警告
$user = new User();
$user->emali = 'a@example.com'; // 拼写错误也会静默创建一个属性

// ✅ 声明属性，或使用专用数据结构
final class User
{
    public function __construct(
        public string $email,
    ) {}
}
```

`#[AllowDynamicProperties]` 应仅用于旧代码兼容例外，不应成为新代码默认选择。留意序列化、ORM 对象填充及测试替身对动态属性的隐藏依赖。

### 构造函数中不要执行繁重 I/O

```php
<?php

// ❌ 在构造函数中隐式连接数据库，不利于测试与错误处理
final class ReportService
{
    private PDO $pdo;

    public function __construct()
    {
        $this->pdo = new PDO($_ENV['DSN']);
    }
}

// ✅ 从外部注入依赖
final class ReportService
{
    public function __construct(
        private PDO $pdo,
    ) {}
}
```

构造函数应建立对象不变量，不应发送 HTTP 请求、建立连接、读取大文件或执行复杂查询。

---

## 输入、输出与安全

### 在边界处校验输入

```php
<?php

// ❌ 超全局变量直接进入业务逻辑
$user = $service->create($_POST['email'], $_POST['age']);

// ✅ 先在边界完成校验与类型转换
$email = filter_input(INPUT_POST, 'email', FILTER_VALIDATE_EMAIL);
$age = filter_input(INPUT_POST, 'age', FILTER_VALIDATE_INT, [
    'options' => ['min_range' => 0, 'max_range' => 130],
]);

if ($email === false || $email === null || $age === false || $age === null) {
    throw new InvalidInput();
}

$user = $service->create($email, $age);
```

`filter_input()` 只能处理部分基本校验。复杂规则、跨字段约束及业务约束仍需专用校验器或请求 DTO。

### 根据上下文转义输出

```php
<?php

// ❌ 用户输入直接进入 HTML
echo "<h1>Hello {$_GET['name']}</h1>";

// ✅ 在 HTML 文本上下文中使用 htmlspecialchars
$name = (string) ($_GET['name'] ?? '');
echo '<h1>Hello ' . htmlspecialchars($name, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '</h1>';
```

HTML 文本、HTML 属性、URL、JavaScript 字符串和 CSS 需要不同的转义方式。关闭模板引擎的默认转义时，应按安全风险检视。

### 密码与随机数

```php
<?php

// ❌ 不得使用 md5/sha1 存储密码
$hash = md5($password);

// ✅ 使用 PHP 内置密码 API
$hash = password_hash($password, PASSWORD_DEFAULT);

if (!password_verify($password, $hash)) {
    throw new InvalidCredentials();
}

// ✅ 使用密码学安全随机数生成器生成令牌
$token = bin2hex(random_bytes(32));
$code = random_int(100000, 999999);
```

不要自行实现盐值、计算轮次升级或密码比较。需要提高计算成本参数时，使用 `password_needs_rehash()`。

### 反序列化与对象注入

```php
<?php

// ❌ 将不可信输入传给 unserialize 可能触发对象注入
$payload = unserialize($_COOKIE['state']);

// ✅ 外部数据优先使用 JSON，并校验其模式与结构
$payload = json_decode($_COOKIE['state'] ?? '{}', true, flags: JSON_THROW_ON_ERROR);
```

必须处理历史序列化数据时，至少限制 `allowed_classes`，并确保相关类的魔术方法不会产生危险副作用。

### 文件上传与路径

```php
<?php

// ❌ 直接使用原始文件名拼接路径
$target = __DIR__ . '/uploads/' . $_FILES['avatar']['name'];
move_uploaded_file($_FILES['avatar']['tmp_name'], $target);

// ✅ 由服务端生成文件名，检查上传错误与 MIME 类型
$file = $_FILES['avatar'];
if ($file['error'] !== UPLOAD_ERR_OK) {
    throw new UploadFailed();
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mime = $finfo->file($file['tmp_name']);
if (!in_array($mime, ['image/png', 'image/jpeg'], true)) {
    throw new InvalidFileType();
}

$target = __DIR__ . '/uploads/' . bin2hex(random_bytes(16)) . '.jpg';
move_uploaded_file($file['tmp_name'], $target);
```

检视上传功能时，检查大小限制、MIME 检测、扩展名、不可执行的存储目录、路径穿越、覆盖保护，以及病毒扫描或异步处理要求。

---

## 数据库访问

### 使用参数化查询

PHP 的 PDO 和 mysqli 均支持预处理语句。绝不将用户输入拼接到 SQL 字符串。动态标识符，例如表名和列名，必须经过白名单映射。

> **跨语言 SQL 注入防护详见 [SQL Injection Prevention Guide](cross-cutting/sql-injection-prevention.md)**，含 Python/Java/Go/Node.js/PHP/C# 示例及 ORM 不安全用法。

### 用事务包装多步写入

```php
<?php

// ❌ 多步写入没有事务，失败后会留下部分完成的状态
$orderId = $orders->create($cart);
$inventory->reserve($cart);
$payments->charge($orderId);

// ✅ 明确事务边界
$pdo->beginTransaction();
try {
    $orderId = $orders->create($cart);
    $inventory->reserve($cart);
    $payments->recordIntent($orderId);
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    throw $e;
}
```

不要随意将不可回滚的外部副作用，例如真实扣款、发送邮件或消息，放进数据库事务。常见处理方式包括发件箱模式、幂等键或事务提交后触发。

### 避免 N+1 查询

> 📖 跨语言 N+1 模式与解决方案见 [N+1 查询指南](cross-cutting/n-plus-one-queries.md)。

```php
<?php

// ❌ 在循环中查询
foreach ($orders as $order) {
    $customer = $customerRepo->find($order->customerId);
    render($order, $customer);
}

// ✅ 批量加载后再映射
$customerIds = array_unique(array_map(fn ($o) => $o->customerId, $orders));
$customers = $customerRepo->findByIds($customerIds);

foreach ($orders as $order) {
    render($order, $customers[$order->customerId] ?? null);
}
```

使用 Laravel/Doctrine 等 ORM 时，检查预加载、关联抓取、选取的列、分页和索引。

---

## 错误处理

> 📖 跨语言错误处理原则见[错误处理指南](cross-cutting/error-handling-principles.md)。

### 捕获具体异常，保留上下文

```php
<?php

// ❌ 吞掉异常后，调用方无法知道操作失败
try {
    $mailer->send($message);
} catch (Exception $e) {
}

// ✅ 捕获特定异常，保留上下文并重新抛出
try {
    $mailer->send($message);
} catch (TransportException $e) {
    throw new NotificationFailed($userId, previous: $e);
}
```

生产代码中的空 `catch`、仅 `error_log()` 后继续且不暴露失败、将所有异常转成 `RuntimeException('failed')` 等做法，都应提出质疑。

### 不要用 @ 抑制错误

```php
<?php

// ❌ 隐藏真实错误，使调试困难
$content = @file_get_contents($path);

// ✅ 显式处理失败
$content = file_get_contents($path);
if ($content === false) {
    throw new RuntimeException("Unable to read file: {$path}");
}
```

`@` 常出现在文件、网络、数组访问及旧库调用附近。应采用显式分支处理，或将第三方错误转换为项目异常。

### 日志不要泄露敏感数据

```php
<?php

// ❌ 将令牌、密码或完整请求体写入日志
$logger->error('Login failed', ['request' => $_POST]);

// ✅ 记录有助于定位问题的非敏感上下文
$logger->warning('Login failed', [
    'email_hash' => hash('sha256', strtolower($email)),
    'ip' => $requestIp,
]);
```

检查日志、异常消息、调试工具栏、错误页面和失败队列记录。敏感信息包括密码、令牌、会话、个人身份信息、支付数据和完整 Cookie。

---

## Composer 与依赖

### 锁定可复现的依赖

```json
{
  "require": {
    "php": "^8.2",
    "monolog/monolog": "^3.0"
  },
  "require-dev": {
    "phpunit/phpunit": "^11.0",
    "phpstan/phpstan": "^1.10"
  }
}
```

检视 `composer.json` / `composer.lock` 时，关注：

- 应用仓提交 `composer.lock`，库仓通常不提交。
- `require-dev` 依赖不应进入生产镜像。
- PHP 平台版本与 CI 版本一致。
- 自动加载范围不过宽，不加载测试或脚本目录。
- `scripts` 命令不依赖开发人员本地的秘密配置。

### 依赖安全与维护情况

```bash
composer audit
composer outdated --direct
composer validate --strict
```

新增包时检查其维护状态，下载量并非唯一信号。应关注安全历史、发布节奏、依赖规模，以及是否重复标准库或框架内置能力。

---

## 性能与资源管理

### 使用生成器或分页流式处理大数据集

```php
<?php

// ❌ 一次加载所有记录
$rows = $repo->all();
foreach ($rows as $row) {
    exportRow($row);
}

// ✅ 使用分页或生成器，避免内存骤增
foreach ($repo->cursor() as $row) {
    exportRow($row);
}
```

PHP 请求生命周期较短，但 CLI 作业、队列工作进程和导出任务可能长期运行。对此类代码尤其关注内存增长、未关闭资源和全局状态污染。

### 避免在循环中执行高开销工作

```php
<?php

// ❌ 每次循环都重新解析配置或打开连接
foreach ($items as $item) {
    $client = new ApiClient($_ENV['API_KEY']);
    $client->send($item);
}

// ✅ 在循环外创建可复用依赖
$client = new ApiClient($_ENV['API_KEY']);
foreach ($items as $item) {
    $client->send($item);
}
```

留意循环中的数据库查询、HTTP 请求、正则编译、大数组复制、累计式 `array_merge()` 追加，以及重复读取环境变量或配置文件。

### 释放资源或明确资源作用域

```php
<?php

// ✅ 使用后关闭文件句柄
$handle = fopen($path, 'rb');
if ($handle === false) {
    throw new RuntimeException('Unable to open file');
}

try {
    while (($line = fgets($handle)) !== false) {
        process($line);
    }
} finally {
    fclose($handle);
}
```

PDO 连接通常由容器管理，但文件句柄、curl 句柄、临时文件、锁和队列工作进程中的缓存对象仍需明确生命周期。

---

## 测试与静态分析

### 测试行为，而非实现细节

```php
<?php

// ❌ 断言内部方法调用会提高重构成本
$mailer->expects($this->once())->method('buildTemplate');

// ✅ 断言可观察的结果
$service->sendWelcomeEmail($user);

$this->assertTrue($mailbox->hasMessageFor($user->email));
```

业务服务、控制器和队列作业应优先覆盖可观察行为：输入输出、数据库状态、发布的事件和分发的消息。

### 静态分析与格式化

```bash
vendor/bin/phpunit
vendor/bin/phpstan analyse
vendor/bin/psalm
vendor/bin/php-cs-fixer fix --dry-run --diff
vendor/bin/rector process --dry-run
```

检视变更时，检查新代码是否降低 PHPStan/Psalm 等级、大量依赖基线忽略项，或用 `@phpstan-ignore-next-line` 掩盖真实类型问题。

### 隔离测试数据

```php
<?php

// ❌ 测试依赖真实时间和外部服务
$service->expireOldSessions();

// ✅ 注入时钟与网关替身
$clock->setNow(new DateTimeImmutable('2026-01-01T00:00:00Z'));
$service->expireOldSessions();
```

关注数据库事务回滚、夹具清理、随机数、时间、队列、缓存和外部 API。PHP 测试慢通常源于边界未隔离，而非语言本身。

---

## 检视清单

### 类型与建模

- [ ] 文件顶部有 `declare(strict_types=1);`
- [ ] 参数、返回值和属性均显式声明类型
- [ ] 使用 `===` / `!==`，集合查找启用严格模式
- [ ] 稳定的状态集合使用枚举，而非魔法字符串
- [ ] 新代码不依赖动态属性
- [ ] 值对象只读或通过其他方式保持不可变

### 安全性

- [ ] 在边界处校验输入并完成类型转换
- [ ] 按 HTML/URL/JS/CSS 上下文转义输出
- [ ] SQL 使用预处理语句或 ORM 参数绑定
- [ ] 动态表名、列名和排序字段经过白名单
- [ ] 密码使用 `password_hash()` / `password_verify()`
- [ ] 令牌、验证码和文件名使用 `random_bytes()` / `random_int()`
- [ ] 不可信输入不会传入 `unserialize()`
- [ ] 文件上传检查错误码、大小、MIME、扩展名和存储目录
- [ ] shell 命令、路径构造和日志输出不存在注入或泄露风险

### 数据与事务

- [ ] 多步写入有事务或补偿机制
- [ ] 外部副作用具有幂等设计
- [ ] 已避免 N+1 查询
- [ ] 分页、索引及选取的列合理
- [ ] 不吞掉数据库错误

### 可维护性

- [ ] 构造函数不执行繁重 I/O
- [ ] 依赖注入清晰，无隐藏全局状态
- [ ] 不使用 `@` 抑制错误
- [ ] 异常保留上下文及 `previous`
- [ ] Composer 依赖范围、自动加载和脚本合理
- [ ] 应用仓已提交 `composer.lock`

### 测试与工具

- [ ] PHPUnit/Pest 覆盖关键路径和失败路径
- [ ] PHPStan/Psalm 配置未降低严格程度
- [ ] 新增忽略项和基线有说明
- [ ] 格式化工具及 CI 命令可复现
- [ ] 测试隔离时间、随机数、数据库、队列及外部 API

---

## 参考资料

- [PHP 手册：类型声明](https://www.php.net/manual/en/language.types.declarations.php)
- [PHP 手册：match](https://www.php.net/match)
- [PHP 手册：枚举](https://www.php.net/manual/en/language.enumerations.overview.php)
- [PHP 手册：属性](https://www.php.net/manual/en/language.oop5.properties.php)
- [PHP 手册：PDO](https://www.php.net/manual/en/class.pdo.php)
- [PHP 手册：password_hash](https://www.php.net/manual/en/function.password-hash.php)
- [PHP 手册：random_bytes](https://www.php.net/manual/en/function.random-bytes.php)
- [Composer 文档](https://getcomposer.org/doc/)
- [PHPUnit 文档](https://docs.phpunit.de/)
- [PHPStan 文档](https://phpstan.org/user-guide/getting-started)
- [Psalm 文档](https://psalm.dev/docs/)
