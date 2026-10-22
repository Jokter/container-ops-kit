# 安全检视指南

基于 OWASP Top 10 和最佳实践的安全代码检视清单。

## 认证与授权

### 认证
- [ ] 密码使用 bcrypt、argon2 等强哈希算法
- [ ] 落实密码复杂度要求
- [ ] 连续失败后锁定账号
- [ ] 密码重置流程安全
- [ ] 敏感操作使用多因素认证
- [ ] 会话令牌具有密码学安全的随机性
- [ ] 实现会话超时

### 授权
- [ ] 每个请求均执行授权检查
- [ ] 遵循最小权限原则
- [ ] 正确实现基于角色的访问控制（RBAC）
- [ ] 不存在权限提升路径
- [ ] 检查直接对象引用，防范 IDOR
- [ ] API 接口受到适当保护

### JWT 安全
```typescript
// ❌ 不安全的 JWT 配置
jwt.sign(payload, 'weak-secret');

// ✅ 安全的 JWT 配置
jwt.sign(payload, process.env.JWT_SECRET, {
  algorithm: 'RS256',
  expiresIn: '15m',
  issuer: 'your-app',
  audience: 'your-api'
});

// ❌ 未正确验证 JWT
const decoded = jwt.decode(token);  // 没有验证签名！

// ✅ 验证签名与声明
const decoded = jwt.verify(token, publicKey, {
  algorithms: ['RS256'],
  issuer: 'your-app',
  audience: 'your-api'
});
```

## 输入校验

### SQL 注入防护

**首要规则：** 始终使用参数化查询，绝不将用户输入拼接进 SQL 字符串。

主流语言和框架均提供参数化查询机制：
- Python：cursor.execute("SELECT ...", params) 或 ORM 筛选方法
- Java：PreparedStatement，或 JPA @Query 配合 @Param
- Go：db.Query("SELECT ...", args...)
- Node.js：client.query("SELECT ...", [args]) 或 Prisma ORM
- PHP：PDO 预处理语句或 Laravel Eloquent
- C#：ADO.NET SqlParameter、Dapper 或 EF Core LINQ

> **完整跨语言示例、ORM 不安全模式、动态标识符处理和检测工具，见 [SQL 注入防护指南](cross-cutting/sql-injection-prevention.md)。**

### XSS 防护

**首要规则：** 使用框架自动转义，审查每个绕过转义的入口。

主流框架默认自动转义：
- React：JSX 自动转义，重点审查 dangerouslySetInnerHTML。
- Vue：{{ }} 自动转义，重点审查 v-html。
- Angular：插值自动转义，重点审查 bypassSecurityTrustHtml。
- Svelte：{ } 自动转义，重点审查 {@html}。
- Django：模板自动转义，重点审查 mark_safe。

为实施纵深防御，配置具有 nonce 型 script-src 的内容安全策略（CSP）。

> **完整跨框架示例、CSP 配置、输入校验与输出编码的区别以及检测工具，见 [XSS 防护指南](cross-cutting/xss-prevention.md)。**

### CSRF 防护

**CSRF 令牌实现**
```typescript
// ✅ 服务端生成并验证 CSRF 令牌
import crypto from 'node:crypto';

function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 中间件：对修改状态的请求验证令牌
app.post('/api/data', (req, res) => {
  const token = req.headers['x-csrf-token'];
  const sessionToken = req.session.csrfToken;
  if (!token || token !== sessionToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  // ……处理请求
});
```

**Python (Django)**
```python
# ✅ Django 内置 CSRF 防护
# settings.py
MIDDLEWARE = [
    'django.middleware.csrf.CsrfViewMiddleware',  # 默认启用
]

# 模板中包含 CSRF 令牌
# <form method="post">
#   {% csrf_token %}
# </form>

# ❌ 在视图上禁用 CSRF
@csrf_exempt  # 除非绝对必要，否则不使用
def my_view(request):
    ...
```

**Java (Spring Boot)**
```java
// ✅ Spring Security 默认启用 CSRF
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) {
        http.csrf(csrf -> csrf
            .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
        );
        return http.build();
    }
}
```

**SameSite Cookie 设置**
```typescript
// ✅ 设置 SameSite Cookie 作为额外防护
res.cookie('session', sessionId, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',  // 或 'lax' 用于允许导航 GET 请求
  maxAge: 3600000,
});
```

### SSRF 防护

```python
# ❌ 存在漏洞：URL 由用户控制
import requests
url = request.GET.get('url')
response = requests.get(url)

# ✅ 根据允许列表校验 URL
ALLOWED_HOSTS = ['api.example.com', 'cdn.example.com']

def is_safe_url(url: str) -> bool:
    from urllib.parse import urlparse
    parsed = urlparse(url)
    return parsed.hostname in ALLOWED_HOSTS

if is_safe_url(url):
    response = requests.get(url)
```

```typescript
// ❌ 存在漏洞：请求任意 URL
const url = req.query.url;
const response = await fetch(url);

// ✅ 请求前校验 URL
const ALLOWED_DOMAINS = ['api.internal.com'];

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // 阻止访问内部 IP
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return false;
    }
    if (parsed.hostname.match(/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./)) {
      return false; // 阻止访问私有 IP 网段
    }
    return ALLOWED_DOMAINS.includes(parsed.hostname);
  } catch {
    return false;
  }
}
```

```go
// ✅ Go：发起请求前校验 URL
import "net/url"

func isSafeURL(rawURL string) bool {
    u, err := url.Parse(rawURL)
    if err != nil {
        return false
    }
    // 阻止访问内部 IP
    if u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" {
        return false
    }
    // 仅允许 HTTPS
    if u.Scheme != "https" {
        return false
    }
    return true
}
```

### IDOR（不安全直接对象引用）

```python
# ❌ 存在漏洞：未检查所有权
def get_order(request, order_id):
    order = Order.objects.get(id=order_id)  # 任何用户可查看任何订单
    return JsonResponse(order.to_dict())

# ✅ 返回前检查所有权
def get_order(request, order_id):
    order = Order.objects.filter(id=order_id, user=request.user).first()
    if not order:
        return JsonResponse({'error': 'Not found'}, status=404)
    return JsonResponse(order.to_dict())
```

```typescript
// ❌ 存在漏洞：未检查授权
app.get('/api/orders/:id', async (req, res) => {
  const order = await db.order.findUnique({
    where: { id: Number(req.params.id) }
  });
  res.json(order);
});

// ✅ 在查询中加入用户上下文
app.get('/api/orders/:id', async (req, res) => {
  const order = await db.order.findFirst({
    where: {
      id: Number(req.params.id),
      userId: req.user.id,  // 限制为当前用户的数据
    }
  });
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});
```

```java
// ✅ Spring Security：方法级授权
@GetMapping("/api/orders/{id}")
@PreAuthorize("@orderService.isOwner(#id, authentication.principal.id)")
public Order getOrder(@PathVariable Long id) {
    return orderService.findById(id);
}
```

**UUID vs 自增 ID**
```typescript
// ❌ 自增 ID 可被枚举
// GET /api/users/1, /api/users/2, /api/users/3 ...

// ✅ UUID 不可预测
// GET /api/users/550e8400-e29b-41d4-a716-446655440000

// ⚠️ UUID 只是防止枚举，不是权限控制
// 仍然需要验证当前用户是否有权访问该资源
```

### 命令注入防护

**Python**
```python
# ❌ Vulnerable: shell=True
import subprocess
subprocess.run(f"convert {filename} output.png", shell=True)

# ✅ 使用列表参数，不经过 shell
subprocess.run(['convert', filename, 'output.png'], check=True)

# ✅ 校验并净化输入
import shlex
safe_filename = shlex.quote(filename)
```

**Node.js**
```typescript
// ❌ 存在漏洞：exec 配合字符串插值
import { exec } from 'node:child_process';
exec(`convert ${filename} output.png`);

// ✅ 使用 execFile 与参数数组
import { execFile } from 'node:child_process';
execFile('convert', [filename, 'output.png'], (error, stdout) => {
  if (error) throw error;
});

// ❌ 不要将用户输入传给 shell
exec(`echo ${userInput}`);  // userInput = "; rm -rf /"

// ✅ 净化输入，或使用无需 shell 的替代方案
import { writeFile } from 'node:fs/promises';
await writeFile('output.txt', userInput);  // 不经过 shell
```

**Go**
```go
// ❌ 存在漏洞：shell 命令包含用户输入
cmd := exec.Command("sh", "-c", "echo " + userInput)

// ✅ 使用 exec.Command，并分别传递参数
cmd := exec.Command("echo", userInput)

// ❌ 将用户输入传给 shell
out, _ := exec.Command("bash", "-c", "cat "+filename).Output()

// ✅ 直接读取文件，不经过 shell
data, err := os.ReadFile(filename)
```

**Java**
```java
// ❌ 存在漏洞：Runtime.exec 配合字符串拼接
Runtime.getRuntime().exec("convert " + filename + " output.png");

// ✅ 使用 ProcessBuilder，并分别传递参数
ProcessBuilder pb = new ProcessBuilder("convert", filename, "output.png");
Process process = pb.start();

// ❌ 危险：将用户输入传给 shell
Runtime.getRuntime().exec(new String[]{"sh", "-c", "echo " + userInput});
```

## 数据保护

### 敏感数据处理
- [ ] 源码中不包含秘密信息
- [ ] 秘密信息存放于环境变量或秘密管理系统
- [ ] 敏感数据静态存储加密
- [ ] 敏感数据传输加密，使用 HTTPS
- [ ] 个人身份信息遵循 GDPR 等适用规定处理
- [ ] 不记录敏感数据
- [ ] 必要时安全删除数据

### 配置安全
```yaml
# ❌ 将秘密信息写入配置文件
database:
  password: "super-secret-password"

# ✅ 引用环境变量
database:
  password: ${DATABASE_PASSWORD}
```

### 错误消息
```typescript
// ❌ 泄露敏感信息
catch (error) {
  return res.status(500).json({
    error: error.stack,  // 暴露内部细节
    query: sqlQuery      // 暴露数据库结构
  });
}

// ✅ 返回通用错误信息
catch (error) {
  logger.error('Database error', { error, userId });  // 在内部记录日志
  return res.status(500).json({
    error: 'An unexpected error occurred'
  });
}
```

## API 安全

### 速率限制
- [ ] 所有公开接口具有限流
- [ ] 认证接口采用更严格限制
- [ ] 同时设置用户级和 IP 级限制
- [ ] 超限时合理返回和处理

### CORS 配置
```typescript
// ❌ 过于宽松的 CORS
app.use(cors({ origin: '*' }));

// ✅ 严格限制 CORS
app.use(cors({
  origin: ['https://your-app.com'],
  methods: ['GET', 'POST'],
  credentials: true
}));
```

### HTTP 响应头
```typescript
// 需要设置的安全响应头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  noSniff: true,
  xssFilter: true,
  frameguard: { action: 'deny' }
}));
```

## 密码学

### 安全实践
- [ ] 使用成熟算法，例如 AES-256、RSA-2048 及以上
- [ ] 不自行实现密码算法
- [ ] 使用密码学安全随机数生成器
- [ ] 密钥管理和轮换适当
- [ ] 密钥安全存储，例如 HSM、KMS

### 常见错误
```typescript
// ❌ 不安全的随机数生成
const token = Math.random().toString(36);

// ✅ 密码学安全随机数
const crypto = require('crypto');
const token = crypto.randomBytes(32).toString('hex');

// ❌ 使用 MD5/SHA1 处理密码
const hash = crypto.createHash('md5').update(password).digest('hex');

// ✅ 使用 bcrypt 或 argon2
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 12);
```

## 依赖安全

### 检查清单
- [ ] 依赖仅来自可信来源
- [ ] 无已知漏洞，通过 npm audit、cargo audit 等检查
- [ ] 依赖保持更新
- [ ] 已提交 package-lock.json、Cargo.lock 等锁文件
- [ ] 尽量减少依赖
- [ ] 已核实许可证合规性

### 审计命令
```bash
# Node.js
npm audit
npm audit fix

# Python
pip-audit
safety check

# Rust
cargo audit

# General
snyk test
```

## 日志与监控

### 安全日志
- [ ] 日志不含密码、令牌、个人身份信息等敏感数据
- [ ] 日志受到防篡改保护
- [ ] 日志保留期限适当
- [ ] 记录登录尝试、权限变更等安全事件
- [ ] 防范日志注入

```typescript
// ❌ 记录敏感数据
logger.info(`User login: ${email}, password: ${password}`);

// ✅ 安全的日志记录
logger.info('User login attempt', { email, success: true });
```

## 安全检视严重程度

| 等级 | 描述 | 处理方式 |
|----------|-------------|--------|
| **严重** | 可立即利用，存在数据泄露风险 | 阻塞合入，立即修复 |
| **高** | 重大漏洞，需要特定触发条件 | 阻塞合入，发布前修复 |
| **中** | 中等风险，涉及纵深防御不足 | 应修复，可在明确跟踪下合入 |
| **低** | 轻微问题，不符合最佳实践 | 建议修复，不阻塞合入 |
| **信息** | 改进建议 | 可选增强 |
