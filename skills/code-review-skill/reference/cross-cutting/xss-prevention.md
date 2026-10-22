# XSS 防护指南

语言无关的跨站脚本防护策略，附跨框架代码示例。

> **相关资料：** 完整安全检查清单与决策框架见[安全检视指南](../security-review-guide.md)。

## XSS 类型

XSS 在 OWASP Top 10（2021）中并入排名第三的注入类别。分为三种类型：

| 类型 | 描述 | 攻击入口 |
|------|-------------|---------------|
| **反射型** | 服务端将恶意脚本反射到响应中 | URL 参数、表单提交 |
| **存储型（持久型）** | 恶意脚本存入数据库，再提供给用户 | 评论、资料、消息 |
| **基于 DOM** | 客户端 JavaScript 不安全地修改 DOM | innerHTML、document.write()、eval() |

## 通用防护策略

1. **输出编码**：按呈现上下文编码数据，包括 HTML、JS、URL、CSS。
2. **内容安全策略（CSP）**：限制可执行脚本。
3. **输入净化**：需要富文本时使用 DOMPurify 等工具。
4. **框架自动转义**：默认使用框架能力，并审查绕过转义的入口。

> **关键区别：** 输入校验阻止不合规数据进入系统；输出编码防止数据被作为代码渲染。两者都需要，单独依赖任一项都不充分。

---

## 跨框架示例

### React

```typescript
// ✅ React 自动转义 JSX 表达式（默认安全）
return <div>{userInput}</div>;

// ❌ dangerouslySetInnerHTML 绕过转义
return <div dangerouslySetInnerHTML={{ __html: userInput }} />;

// ✅ 必须使用 HTML 时，先进行净化
import DOMPurify from 'dompurify';
return <div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userInput)
}} />;

// ❌ href 使用 javascript: 协议
return <a href={`javascript:void(${userInput})`}>Click</a>;

// ✅ 校验 URL 协议
const safeUrl = userInput.startsWith('https://') ? userInput : '#';
return <a href={safeUrl}>Click</a>;

// ❌ 将用户输入传给 eval / new Function
const result = eval(userInput);

// ❌ 在 ref / effect 中使用 innerHTML
useEffect(() => {
  ref.current.innerHTML = userInput;
}, [userInput]);
```

### Vue

```html
<!-- ✅ Vue 自动转义文本插值 -->
<div>{{ userInput }}</div>

<!-- ❌ v-html 绕过转义 -->
<div v-html="userInput"></div>

<!-- ✅ 使用 v-html 前先净化 -->
<div v-html="sanitized(userInput)"></div>
```

```typescript
import DOMPurify from 'dompurify';

export default {
  methods: {
    sanitized(input: string): string {
      return DOMPurify.sanitize(input);
    }
  }
};

// ❌ v-bind:href 使用 javascript: 协议
// <a :href="userInput">Click</a> — userInput 可能为 "javascript:alert(1)"
```

### Angular

```typescript
// ✅ Angular 自动转义插值内容（默认安全）
template: `<div>{{ userInput }}</div>`

// ❌ bypassSecurityTrustHtml 禁用了净化
import { DomSanitizer } from '@angular/platform-browser';

constructor(private sanitizer: DomSanitizer) {
  this.unsafe = this.sanitizer.bypassSecurityTrustHtml(userInput);
}

// ❌ 对 javascript: 协议使用 bypassSecurityTrustUrl
this.unsafeUrl = this.sanitizer.bypassSecurityTrustUrl(userInput);

// ✅ 仅对服务端验证过的内容使用 bypassSecurityTrust*
// 并说明原因
```

### Svelte

```svelte
<!-- ✅ Svelte 自动转义表达式 -->
<div>{userInput}</div>

<!-- ❌ {@html} 绕过转义 -->
<div>{@html userInput}</div>

<!-- ✅ 使用 {@html} 前先净化 -->
<script>
  import DOMPurify from 'dompurify';
  const sanitized = DOMPurify.sanitize(userInput);
</script>
<div>{@html sanitized}</div>
```

### Django（服务端）

```python
# ✅ Django 自动转义模板变量
# template: <p>{{ user_bio }}</p>

# ❌ mark_safe 绕过自动转义
from django.utils.safestring import mark_safe
return HttpResponse(mark_safe(f"<p>{user_bio}</p>"))

# ❌ 在模板中关闭 autoescape
# {% autoescape off %}{{ user_bio }}{% endautoescape %}

# ✅ 必须使用 mark_safe 时，先进行转义
from django.utils.html import escape
return HttpResponse(mark_safe(f"<p>{escape(user_bio)}</p>"))
```

### 服务端渲染

```typescript
// ❌ SSR：将用户原始数据注入 HTML
const html = `<div>${userInput}</div>`;

// ✅ 始终转义服务端渲染内容
import escapeHtml from 'escape-html';
const html = `<div>${escapeHtml(userInput)}</div>`;

// ❌ JSON 序列化后未进行转义
const json = JSON.stringify({ name: userInput });
// userInput 可能包含 </script>，从而跳出 script 标签

// ✅ HTML 中的 JSON：转义 < 和 >
const safe = JSON.stringify({ name: userInput })
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e');
```

---

## 内容安全策略（CSP）

CSP 属于纵深防御。即便 XSS 绕过输出编码，CSP 仍可限制攻击者的能力。

```nginx
# ✅ 推荐的严格 CSP
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}' 'strict-dynamic';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
```

```typescript
// ✅ Express 中间件
import helmet from 'helmet';

app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'nonce-{random}'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  },
}));
```

```html
<!-- ✅ script 标签中的 CSP nonce -->
<script nonce="{random}">
  // CSP 允许执行
</script>

<!-- ❌ 内联事件处理器（未启用 'unsafe-inline' 时会被 CSP 阻止） -->
<button onclick="doSomething()">Click</button>

<!-- ✅ 在带 nonce 的 JavaScript 中注册事件监听器 -->
<script nonce="{random}">
  document.getElementById('btn').addEventListener('click', doSomething);
</script>
```

**应避免的 CSP 反模式：**
- 没有 nonce/hash 配合的 `script-src 'unsafe-inline'`
- `script-src 'unsafe-eval'`，允许执行 eval()
- `default-src *`，允许从任意来源加载
- `script-src https:`，允许所有 HTTPS 来源，包括攻击者控制的来源

---

## 输入校验与输出编码

| 层次 | 作用 | 时机 | 示例 |
|-------|------|------|---------|
| **输入校验** | 在入口拒绝或清理数据 | API 边界 | 拒绝姓名字段中的 script 标签 |
| **输出编码** | 根据呈现上下文编码数据 | 渲染时 | 在 HTML 中使用 `&lt;script&gt;` |

**规则：** 输入校验有助于拒绝明显不合规的数据，输出编码才是防止数据被解释为代码的关键边界。不能仅依赖输入校验。

---

## 检测与测试

```bash
# 自动化扫描
# OWASP ZAP
zap-cli quick-scan --spider https://example.com

# 手工测试载荷
<script>alert(1)</script>
<img src=x onerror=alert(1)>
" onmouseover="alert(1)
javascript:alert(1)
'-alert(1)-'

# 静态分析（代码检视）
grep -rn "innerHTML\|dangerouslySetInnerHTML\|v-html\|bypassSecurityTrust\|mark_safe\|@html\|{@html" src/
grep -rn "eval(\|new Function\|document.write\|setTimeout.*string\|setInterval.*string" src/
```

---

## 检视清单

- [ ] 默认使用框架自动转义，避免自行实现
- [ ] 已审查 dangerouslySetInnerHTML、v-html、bypassSecurityTrust、{@html}、mark_safe
- [ ] 绕过自动转义输出 HTML 前，使用 DOMPurify.sanitize() 或等价处理
- [ ] CSP 配置基于 nonce 或 hash 的 script-src
- [ ] 不将用户输入用于 eval()、new Function() 或 javascript: URL
- [ ] 启用 CSP 时不使用 onclick="..." 等内联事件处理器
- [ ] 服务端渲染内容在插入前已转义
- [ ] HTML 中的 JSON 正确转义，例如 `</script>` → `\u003c/script\u003e`
