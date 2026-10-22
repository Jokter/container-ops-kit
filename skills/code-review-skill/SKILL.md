---
name: code-review-skill
description: |
  对代码变更进行系统性检视，检查逻辑正确性、边界条件、异常处理、并发安全、
  安全漏洞、大 SQL、大规格性能、测试覆盖、代码质量及架构合理性；提出有依据、供开发确认的疑点。
  当用户要求代码检视、代码审查、MR 检视、PR Review、审查合并请求、
  检视分支差异或提交变更时使用。
  也适用于建立检视标准、指导开发人员、架构评审、安全审计和性能评审。
---

# 代码检视技能

通过建设性反馈、系统性分析和协作改进，使代码检视既能发现问题，也能促进知识共享。

## 适用场景

- 检视合并请求和代码变更。
- 建立团队代码检视标准。
- 在检视过程中指导初级开发人员。
- 开展架构评审。
- 创建检视清单和指南。
- 改善团队协作。
- 缩短代码检视周期。
- 维护代码质量标准。

## 核心原则

### 1. 检视思路

**代码检视的目标：**
- 发现缺陷和边界情况。
- 确保代码可维护。
- 在团队内分享知识。
- 落实编码规范。
- 改进设计和架构。
- 建设团队文化。

**不应作为检视目标的事项：**
- 炫耀知识。
- 纠缠格式细节；此类问题交给静态检查工具处理。
- 无必要地阻碍进度。
- 按个人偏好重写他人的实现。

### 2. 有效反馈

**好的反馈应具备以下特点：**
- 具体且可执行。
- 有助于理解和学习，不作主观评判。
- 针对代码，不针对个人。
- 兼顾问题和做得好的地方。
- 区分优先级，明确必须修复的问题和可选建议。

```markdown
❌ 不佳：“这不对。”
✅ 更好：“多个用户同时访问时，这里可能发生竞态条件。可以考虑使用互斥锁。”

❌ 不佳：“为什么不用 X 模式？”
✅ 更好：“这三个流程重复维护相同的数据访问规则，新增条件时需要同步修改。是否考虑集中维护？请确认这些规则是否需要保持一致。”

❌ 不佳：“把这个变量重命名。”
✅ 更好：“[nit] 建议将 uc 改为 userCount，使含义更清晰。如果更倾向于现有命名，此建议不阻塞合入。”
```

### 3. 有依据的疑点

- 允许提出尚未完全证实、但有具体代码依据且值得开发确认的风险；不要求获得生产指标后才能提问。
- 每条意见用简短自然段说明：代码现象、触发条件及可能影响、需要开发确认的事项。已证实的缺陷直接说明；未知数据规模、索引或运行配置明确为待确认条件，不得当作事实。
- 提问前检查相关调用方、已有保护措施和必要上下文；已有明确限制消除风险时不再提出相同疑点。无法读取上下文时说明具体缺口，不编造已核验结论。
- 以本次变更涉及的完整业务链路和相关模块为范围，必要时查阅公共实现；不将每次 MR 扩大成全仓重构评审。
- 一条意见聚焦一个根因，定位到最能体现问题的文件和代码行，其他相关位置放在正文。不要逐行重复，也不因行号移动重复历史意见。
- 不提交无具体依据的提醒、纯格式偏好或为凑检查项而生成的意见。分析可以深入，输出保持简短；没有问题可以不提意见。
- 开发可通过修改或业务解释回应疑点；解释充分时无需为关闭意见而强制改代码。回复“收到”“稍后处理”不代表修复或确认；接受风险与代码修复应分别说明，关闭权限遵循调用方流程。
- 优先级按潜在影响及成立条件判断，不能将“尚未证实”一律当作低风险，也不能把所有疑点都标为阻塞。标记本身不改变平台的合入门禁，不承诺未闭环意见可直接合入。

### 4. 检视范围

**需要检查：**
- 逻辑正确性和边界情况。
- 安全漏洞。
- 性能影响。
- 测试覆盖和测试质量。
- 异常处理。
- 文档和注释。
- API 设计和命名。
- 与现有架构的匹配程度。

**无需手工检查：**
- 代码格式，使用 Prettier、Black 等工具。
- 导入语句的组织和排序。
- 静态检查工具已经能够发现的违规项。
- 简单拼写错误。

## 检视流程

### 阶段一：收集上下文（2～3 分钟）

深入代码前，先了解以下内容：
1. 阅读合并请求描述和关联问题。
2. 检查变更规模；超过 400 行时建议拆分。
3. 检查 CI/CD 状态，确认测试是否通过。
4. 理解业务需求。
5. 记录相关架构决策。

> 对于较大的差异，可将 diff 传入 [`scripts/pr-analyzer.py`](scripts/pr-analyzer.py)，先评估复杂度和推荐检视方式，再阅读代码。

### 阶段二：整体检视（5～10 分钟）

1. **架构与设计**：方案是否适合解决当前问题？
   - 重要变更参考[架构检视指南](reference/architecture-review-guide.md)。
   - 检查具体维护成本：重复分支、职责耦合、扩展时需要同步修改多处，以及已有能力能否复用。先考虑简单调整，再评估设计模式的收益与成本，不为代码评选增加抽象。
2. **性能评估**：是否存在性能隐患？
   - 性能敏感代码参考[性能检视指南](reference/performance-review-guide.md)。
   - 从调用入口追到实际 SQL/ORM，检查查询范围、分页/批次上限、大 IN、循环查询和事务范围。
   - 沿租户、资源、任务等数量增长路径，分析查询次数、并发/队列、全量汇总内存和执行时间；已知上限引用来源，未知上限请开发确认。详见性能指南中的“大 SQL 与大规格场景”。
3. **文件组织**：新增文件是否放在适当位置？
4. **测试策略**：是否有测试覆盖边界情况？

### 阶段三：逐行检视（10～20 分钟）

逐文件检查：
- **逻辑与正确性**：边界情况、差一错误、空值检查、竞态条件。
- **安全性**：输入校验、注入风险、XSS、敏感数据。
- **性能**：N+1 查询、不必要的循环、内存泄漏。
- **可维护性**：命名清晰、单一职责、注释适当。
- **复用**：接受新代码前，搜索是否存在可替代它的工具或辅助函数。检查相邻文件和公共模块中的类似模式。参考[通用代码质量指南](reference/code-quality-universal.md)，检查参数膨胀、抽象泄漏、嵌套条件、过度使用字符串表达结构化状态、TOCTOU 以及无实际变化的更新等反模式。

### 阶段四：总结与结论（2～3 分钟）

1. 总结主要问题。
2. 指出实现中值得肯定的地方。
3. 区分已证实缺陷与待开发确认的疑点；结论遵循调用方输出格式及权限，不代替平台执行审核或合入。一般人工检视可给出：
   - ✅ 通过。
   - 💬 评论：仅有轻微建议。
   - 🔄 请求修改：存在必须处理的问题。
4. 问题复杂时，建议共同讨论或结对处理。

## 检视技巧

### 技巧一：使用检查清单

使用清单保持检视的一致性。完整安全检查项见[安全检视指南](reference/security-review-guide.md)。

### 技巧二：通过提问澄清问题

```markdown
❌ “列表为空时，这段代码会失败。”
✅ “如果 items 是空数组，这里会怎样？”

❌ “这里需要异常处理。”
✅ “如果 API 调用失败，这里期望如何处理？”
```

### 技巧三：提出建议，避免命令式交流

```markdown
❌ “必须改成 async/await。”
✅ “建议：使用 async/await 可能更易读，你怎么看？”

❌ “把这里提取成函数。”
✅ “这段逻辑出现了 3 次，是否适合提取为一个函数？”
```

### 技巧四：区分严重程度

用以下标记表示优先级：

- 🔴 `[blocking]`：阻塞问题，合入前必须修复。
- 🟡 `[important]`：重要问题，应当修复；如有异议，需讨论。
- 🟢 `[nit]`：细节改进，可选且不阻塞合入。
- 💡 `[suggestion]`：值得考虑的替代方案。
- 📚 `[learning]`：知识分享，无需采取行动。
- 🎉 `[praise]`：肯定好的实现。

**严重程度分级：** 本技能所有指南统一采用 🔴 / 🟡 / 🟢 三级：🔴 阻塞合入，🟡 应当处理，🟢 可选。💡 / 📚 / 🎉 为不阻塞合入的补充标记。

## 各语言和框架指南

根据被检视代码使用的语言、框架和实际版本，查阅对应指南：

| 语言或框架 | 参考文件 | 重点内容 |
|---|---|---|
| React | [React 指南](reference/react.md) | Hooks、useEffect、React 19 Actions、RSC、Suspense、TanStack Query v5 |
| Vue 3 | [Vue 指南](reference/vue.md) | 组合式 API、响应式系统、Props/Emits、侦听器、组合式函数 |
| Angular 17+ | [Angular 指南](reference/angular.md) | Signals、独立组件、RxJS、无 Zone 模式、模板优化、测试、路由守卫、HttpInterceptor |
| Rust | [Rust 指南](reference/rust.md) | 所有权与借用、unsafe 检视、异步代码、取消安全性、错误处理 |
| TypeScript | [TypeScript 指南](reference/typescript.md) | 类型安全、async/await、不可变性、测试、模块解析、TS 5.x |
| Python | [Python 指南](reference/python.md) | 可变默认参数、异常处理、类属性 |
| Django / DRF | [Django 指南](reference/django.md) | 安全检视、N+1 查询、序列化器反模式、ViewSet、异步视图 |
| FastAPI | [FastAPI 指南](reference/fastapi.md) | Depends、Pydantic v2 校验、异步正确性、会话与 N+1、认证与授权、测试驱动验证 |
| Java | [Java 指南](reference/java.md) | Java 17/21、Spring Boot 3、虚拟线程、Stream/Optional |
| Java 8 / 旧版技术栈 | [Java 8 指南](reference/java8.md) | Java 8、Spring Boot 2、javax.*、Stream/Optional、java.time、CompletableFuture |
| PHP | [PHP 指南](reference/php.md) | PHP 8.x 类型系统、PDO、安全检视、Composer、PHPUnit/PHPStan |
| Ruby / Rails | [Ruby 指南](reference/ruby.md) | Ruby 语义、Rails 8、Active Record、Active Job、安全、测试 |
| C# / .NET | [C# 指南](reference/csharp.md) | C# 12、异步编程、EF Core 性能、ASP.NET Core、LINQ |
| Go | [Go 指南](reference/go.md) | 错误处理、goroutine/channel、context、接口设计 |
| Kotlin / Android | [Kotlin 指南](reference/kotlin.md) | 协程、Flow、Jetpack Compose、空安全、内存泄漏、架构模式 |
| Swift / SwiftUI | [Swift 指南](reference/swift.md) | 可选值、Swift 并发、Sendable/actor、属性包装器、值与引用语义、API 设计 |
| Dart / Flutter | [Dart 指南](reference/dart.md) | Widget 重建、const 构造函数、空安全、isolate、build 中异步操作、Riverpod/Bloc、平台通道、键和资源释放 |
| NestJS | [NestJS 指南](reference/nestjs.md) | 依赖注入、分层架构、DTO 校验、Guard/Interceptor、循环依赖 |
| Svelte / SvelteKit | [Svelte 指南](reference/svelte.md) | Runes、load 函数、表单操作、Store 迁移、SSR/CSR 边界 |
| C | [C 指南](reference/c.md) | 指针与缓冲区、内存安全、未定义行为、安全编码、可移植性、测试 |
| C++ | [C++ 指南](reference/cpp.md) | RAII、智能指针、C++20/23、constexpr、测试 |
| Zig | [Zig 指南](reference/zig.md) | 分配器、错误联合类型、defer/errdefer、编译期执行、C 互操作 |
| CSS / Less / Sass | [样式指南](reference/css-less-sass.md) | 变量规范、!important、性能优化、响应式布局、兼容性 |
| Qt | [Qt 指南](reference/qt.md) | 对象模型、信号与槽、Model/View、QML、Qt 6 迁移、测试 |

## 跨语言专题指南

以下模式适用于不同语言的代码检视：

| 专题 | 参考文件 | 重点内容 |
|---|---|---|
| 架构检视 | [架构检视指南](reference/architecture-review-guide.md) | SOLID、反模式、耦合与内聚、依赖方向 |
| 性能检视 | [性能检视指南](reference/performance-review-guide.md) | Web Vitals、N+1、算法复杂度、内存泄漏、缓存 |
| 安全检视 | [安全检视指南](reference/security-review-guide.md) | SQL 注入、XSS、CSRF、SSRF、IDOR、命令注入、跨语言示例 |
| 通用质量 | [通用代码质量指南](reference/code-quality-universal.md) | 复用审查、参数膨胀、抽象泄漏、嵌套条件、字符串化状态、TOCTOU、无效更新、冗余状态 |
| 常见缺陷 | [常见缺陷检查清单](reference/common-bugs-checklist.md) | 各语言的缺陷模式和常见陷阱 |
| SQL 注入防护 | [SQL 注入防护指南](reference/cross-cutting/sql-injection-prevention.md) | 参数化查询、ORM 安全、六种语言、动态标识符、检测方法 |
| XSS 防护 | [XSS 防护指南](reference/cross-cutting/xss-prevention.md) | 输出编码、CSP、五种框架、输入校验与编码的区别、检测方法 |
| N+1 查询 | [N+1 查询指南](reference/cross-cutting/n-plus-one-queries.md) | 预加载、批量读取、DataLoader、五种语言、检测方法 |
| 错误处理 | [错误处理指南](reference/cross-cutting/error-handling-principles.md) | 快速失败、错误层次、七种语言、反模式、日志 |
| 异步与并发 | [并发指南](reference/cross-cutting/async-concurrency-patterns.md) | goroutine、async/await、actor、结构化并发、七种语言 |
| 检视最佳实践 | [代码检视最佳实践](reference/code-review-best-practices.md) | 沟通方式、检视思路、反馈方法、严重程度标记 |

## 补充资源

- [合并请求检视模板](assets/pr-review-template.md)：用于撰写检视意见。
- [检视检查清单](assets/review-checklist.md)：快速参考。
