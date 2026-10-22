# 常见缺陷检查清单

按类别整理的缺陷模式速查表。详细代码示例、解释和完整检视清单，请参阅下方链接的各语言专属指南。

## 通用问题

### 逻辑错误
- [ ] 循环或数组访问中存在差一错误
- [ ] 布尔逻辑错误，例如错误应用德摩根定律
- [ ] 缺少 null/undefined 检查
- [ ] 并发代码中存在竞态条件
- [ ] 使用了错误的比较运算符（`==` 与 `===`、`=` 与 `==`）
- [ ] 整数上溢或下溢
- [ ] 浮点数比较问题

### 资源管理
- [ ] 内存泄漏，例如连接未关闭或监听器未移除
- [ ] 文件句柄未关闭
- [ ] 数据库连接未释放
- [ ] 事件监听器未移除
- [ ] 定时器或周期任务未清除

### 错误处理
- [ ] 吞掉异常，例如空的 catch 块
- [ ] 过于宽泛的异常处理掩盖了具体错误
- [ ] 未向上传播错误
- [ ] 抛出了错误的异常类型
- [ ] 缺少 finally 或清理代码块

## TypeScript/JavaScript

- [ ] 使用 `==` 而非 `===`
- [ ] 使用 `any`；应优先选择合适的类型，或结合类型守卫使用 `unknown`
- [ ] 异步调用缺少 `await`
- [ ] Promise 拒绝未处理，例如 await 外没有 try-catch
- [ ] 回调中丢失 `this` 上下文
- [ ] 列表缺少 `key` 属性
- [ ] 闭包捕获了过期的循环变量
- [ ] `parseInt` 未传入进制参数
- [ ] 迭代过程中修改数组或对象

**完整指南：** [TypeScript 检视指南](typescript.md)

## React / React 19

- [ ] 在条件分支或循环中调用 Hook，违反 Hook 规则
- [ ] `useEffect` 依赖数组不完整或不正确
- [ ] `useEffect` 缺少订阅、定时器或请求的清理函数
- [ ] 使用 `useEffect` 计算派生状态，应考虑 `useMemo`
- [ ] 过度使用 `useMemo`/`useCallback`，或未配合 `React.memo`
- [ ] 在另一个组件内部定义组件，导致每次渲染重新挂载
- [ ] props 不稳定，例如向 memo 组件传入内联对象或函数
- [ ] 直接修改 props
- [ ] 列表缺少 `key`，或在可重排列表中使用数组下标作为 key
- [ ] 服务端组件使用客户端 API（`useState`、`useEffect`、`onClick`）
- [ ] 在父组件添加 `'use client'`，导致整个子树在客户端执行
- [ ] `useActionState` 中调用 `setState`，而不是返回新状态
- [ ] 在定义 `<form>` 的同一组件调用 `useFormStatus`，而非在子组件中调用
- [ ] 将 `useOptimistic` 用于支付、删除等关键操作
- [ ] 整个页面只设置一个 Suspense 边界，慢组件阻塞快组件
- [ ] Suspense 外缺少错误边界
- [ ] 每次渲染都向 `use()` Hook 传入新 Promise

**TanStack Query v5:**
- [ ] `queryKey` 未包含影响数据的参数
- [ ] 默认 `staleTime: 0` 导致过于频繁的重新请求
- [ ] 为 `useSuspenseQuery` 设置不受支持的 `enabled` 选项
- [ ] 变更成功后未使相关查询失效
- [ ] 乐观更新缺少 `onError` 回滚
- [ ] 使用 v4 数组语法（`useQuery(['key'], fn)`），而不是 v5 对象语法

**测试：**
- [ ] 使用 `container.querySelector`，而非 `screen.getByRole`
- [ ] 使用 `fireEvent`，而非 `userEvent`
- [ ] 测试实现细节，而非用户可见行为
- [ ] 使用 `getBy*` 查询异步内容，应使用 `findBy*`

**完整指南：** [React 检视指南](react.md)

## Vue 3

- [ ] 解构 `reactive()` 对象导致响应性丢失，应使用 `toRefs`
- [ ] 向组合式函数传入 `props.x`，而非 `() => props.x` 或 `toRef(props, 'x')`
- [ ] `watch` 的异步回调缺少 `onCleanup`，造成竞态条件
- [ ] `computed` 中存在修改状态或调用 API 等副作用
- [ ] 可重排列表的 `v-for` 使用下标作为 `:key`
- [ ] 同一元素同时使用 `v-if` 和 `v-for`
- [ ] `defineProps` 缺少 TypeScript 类型声明
- [ ] `withDefaults` 的对象默认值没有使用工厂函数
- [ ] 直接修改 props，而不是发送事件
- [ ] `watchEffect` 依赖不清晰，导致过度触发

**完整指南：** [Vue 3 检视指南](vue.md)

## Python

- [ ] 使用可变默认参数（`def f(x=[])`）
- [ ] 裸 `except:` 捕获了 `KeyboardInterrupt` 和 `SystemExit`
- [ ] 使用共享的可变类属性（`class C: items = []`）
- [ ] 比较值时使用 `is`，而非 `==`
- [ ] 方法缺少 `self` 参数
- [ ] 遍历列表时修改列表
- [ ] 在循环中拼接字符串，应使用 `"".join()`
- [ ] 文件未关闭，应使用 `with` 语句
- [ ] 公共函数缺少类型标注

**完整指南：** [Python 检视指南](python.md)

## Rust

**所有权与借用：**
- [ ] 为绕过借用检查器而进行不必要的 `clone()`
- [ ] 单一所有者足够时却使用 `Arc<Mutex<T>>`
- [ ] 持有数据所有权更简单时，却在结构体中保存借用
- [ ] 不必要地使用 `RefCell`，将编译期检查变为运行时检查

**不安全代码：**
- [ ] `unsafe` 块缺少说明不变量的 `SAFETY:` 注释
- [ ] `unsafe fn` 缺少 `# Safety` 文档段落
- [ ] 不安全代码的不变量分散在多个模块中

**异步与并发：**
- [ ] 在异步上下文中执行阻塞操作，例如 `std::fs`、`std::thread::sleep`
- [ ] 跨 `.await` 持有 `std::sync::Mutex`
- [ ] 创建的任务缺少 `'static` 生命周期约束
- [ ] 丢弃 Future 而未等待执行，导致任务遗漏

**错误处理：**
- [ ] 生产代码中使用 `unwrap()`/`expect()`
- [ ] 库使用 `anyhow` 而非 `thiserror`，导致调用者无法匹配错误类型
- [ ] 丢弃错误上下文，例如 `map_err(|_| ...)`
- [ ] 忽略 `must_use` 返回值

**性能：**
- [ ] 不必要地调用 `.collect()`，应优先使用惰性迭代器
- [ ] 循环中拼接字符串却未使用 `with_capacity`
- [ ] 可以使用 `impl Trait` 时却使用 `Box<dyn Trait>`

**完整指南：** [Rust 检视指南](rust.md)

## Go

- [ ] 忽略错误，例如 `result, _ := SomeFunction()`
- [ ] goroutine 缺少退出机制，造成泄漏
- [ ] 缺少或错误传播 `context.Context`
- [ ] 循环变量捕获问题（Go 1.22 之前）
- [ ] 在循环中使用 `defer`，实际延迟到函数结束而非当次循环结束
- [ ] 变量遮蔽
- [ ] Map 在初始化之前使用
- [ ] 使用 `%v` 而非 `%w` 包装错误，破坏 `errors.Is`/`errors.As`

**完整指南：** [Go 检视指南](go.md)

## Java / Spring Boot

- [ ] POJO/DTO 手工编写样板代码，未使用 `record`（Java 17+）
- [ ] 传统 switch 缺少 `break`，可考虑 switch 表达式（Java 14+）
- [ ] 使用字段注入，而非构造器注入
- [ ] 存在 JPA N+1 查询，缺少 `fetch join` 或 `@EntityGraph`
- [ ] JPA 实体的 `equals`/`hashCode` 实现不当：避免 `@Data`；优先使用稳定业务键或空值安全的 ID，切勿将所有延迟加载字段纳入比较
- [ ] 未检查 `isPresent()` 就调用 `Optional.get()`
- [ ] Stream 操作存在副作用

**完整指南：** [Java 检视指南](java.md)（17/21 + Boot 3）

## Java 8 / Spring Boot 2（旧版技术栈）

- [ ] 使用共享的 `SimpleDateFormat` 或旧 `Date`，而非 `java.time`
- [ ] `Collectors.toMap` 的值为 null，或缺少合并函数
- [ ] 将 `Optional` 用作字段或参数，或用 `isPresent()` 加 `get()` 替代空值检查
- [ ] `CompletableFuture.supplyAsync` 在 `commonPool` 执行 I/O，未显式指定执行器
- [ ] `RestTemplate` 未设置连接和读取超时
- [ ] 在私有方法或类内自调用方法上使用 `@Transactional`
- [ ] `parallelStream` 使用共享可变状态
- [ ] Boot 2 中混用 `javax.*` 和 `jakarta.*`

**完整指南：** [Java 8 检视指南](java8.md)

## PHP

- [ ] 新文件缺少 `declare(strict_types=1);`
- [ ] 认证、令牌、支付或状态逻辑使用弱比较（`==`、`!=`）
- [ ] `in_array()` / `array_search()` 未启用严格模式
- [ ] 通过字符串拼接构建 SQL，而非使用预处理语句
- [ ] 输出用户输入时没有按输出上下文转义
- [ ] 使用 `md5()` / `sha1()` 存储密码，而非 `password_hash()`
- [ ] 向 `unserialize()` 传入不可信数据
- [ ] PHP 8.2+ 中使用动态属性，而非声明属性
- [ ] 使用 `@` 隐藏错误，或在空 `catch` 块中吞掉错误
- [ ] 文件上传采用客户端提供的名称，或缺少 MIME 类型和大小校验

**完整指南：** [PHP 检视指南](php.md)

## Ruby / Rails

- [ ] 条件判断错误地认为 `0`、`""` 或 `[]` 为假值
- [ ] 多个条目共享可变 Hash/Array 默认值（`Hash.new([])`、`Array.new(3, [])`）
- [ ] 将感叹号方法的返回值当作转换后的对象
- [ ] 裸或过宽的 `rescue` 掩盖无关错误，或暴露 `error.message`
- [ ] 用户输入控制动态 `send`、`constantize`、`eval` 或 SQL 片段
- [ ] 将不可信数据传入 `Marshal.load`、不安全的 YAML 加载或插值 shell 命令
- [ ] 强参数使用 `permit!`、`to_unsafe_h` 或空哈希白名单
- [ ] 嵌套 `params.expect` 数组采用扁平形状，而非必需的 `[[...]]` 形式
- [ ] Active Record 查询将值或动态标识符插值到 SQL 中
- [ ] 在按所有权或策略限定查询范围之前调用 `Model.find(params[:id])`，产生 IDOR
- [ ] `redirect_to` 接受用户控制的 URL，并启用 `allow_other_host: true`，产生开放重定向
- [ ] 使用浏览器认证的状态变更跳过 CSRF 防护，或采用不安全的会话 Cookie 标记
- [ ] 循环中访问关联导致 N+1 查询
- [ ] 关键不变量只有模型校验，没有对应数据库约束
- [ ] `update_all` / `delete_all` 意外跳过回调与校验
- [ ] 批量写入导致 `counter_cache` 偏离实际值，却没有校正机制
- [ ] Active Job 重试可能重复支付、邮件或其他外部副作用
- [ ] GlobalID 作业参数对应的对象可能在反序列化之前被删除
- [ ] 事务中包含无法回滚的外部副作用
- [ ] 创建或支付请求重试时缺少幂等键，可能重复已经提交的操作

**完整指南：** [Ruby 与 Rails 检视指南](ruby.md)

## Swift

- [ ] 可以安全解包时，却使用强制解包 `!` 或 `try!`
- [ ] 闭包强引用捕获 `self`，未使用 `[weak self]`，产生循环引用
- [ ] 需要值类型 `struct` 时，却使用引用类型 `class`
- [ ] 吞掉错误，而非通过 `throws` / `Result` 传播
- [ ] 并发边界存在数据竞争，缺少 `Sendable`、`@MainActor` 或 actor 隔离
- [ ] 即发即忘的 `Task {}` 从不取消或发生泄漏
- [ ] 需要用 `@StateObject` 持有对象时，却使用 `@ObservedObject`
- [ ] 在 IBOutlet 之外使用隐式解包可选值（`var x: T!`）
- [ ] 访问权限过宽，例如 `internal` 足够时却使用 `public` / `open`

**完整指南：** [Swift 检视指南](swift.md)

## Dart / Flutter

- [ ] 静态 Widget 子树缺少 `const`，或使用 `_buildFoo()` 辅助方法而非提取独立 Widget
- [ ] 通过 `!`、`as` 或缺少约束的 `late` 压制空安全检查
- [ ] 在 UI isolate 上执行繁重的 `jsonDecode`、图像或加密计算
- [ ] 在 `build` 内创建 `Future` 或 `Stream`，导致每次重建都产生新实例
- [ ] `await` 后使用 `setState` / `BuildContext`，却未检查 `mounted` / `context.mounted`
- [ ] 在回调中使用 `ref.watch` / `context.watch`，在 `build` 中使用 `read`，或反向误用
- [ ] 向 `BlocProvider.value` / `ChangeNotifierProvider.value` 传入在 `build` 中新建的实例；应使用 `create`，因为 `value` 不负责释放
- [ ] `BlocProvider(create: ...)` 捕获过期 `id`，缺少 `ValueKey(id)` 重新挂载或 `didUpdateWidget` 重新加载；`UniqueKey()` 会在每次重建时重新挂载
- [ ] 平台通道 `invokeMethod` 缺少 `PlatformException` 处理
- [ ] 持有 `State` 的列表子组件缺少稳定 `ValueKey`，或在 `build` 中使用 `UniqueKey()`
- [ ] 未释放 `TextEditingController`、`AnimationController` 或 `StreamSubscription`

**完整指南：** [Dart / Flutter 检视指南](dart.md)

## C

- [ ] 指针或缓冲区越过上界或下界
- [ ] 未定义行为，例如释放后使用、重复释放、空指针解引用
- [ ] 分配内存后缺少错误处理，`malloc` 可能返回 `NULL`
- [ ] 大小计算发生整数溢出
- [ ] 资源泄漏，例如缺少 `free`、`fclose`
- [ ] 文件内部函数或变量缺少 `static`

**完整指南：** [C 检视指南](c.md)

## C++

- [ ] 资源缺少 RAII 包装
- [ ] 违反零/三/五法则，未正确处理析构、复制或移动
- [ ] 异常安全问题，例如适用处缺少 `noexcept`
- [ ] 返回的迭代器或引用成为悬空引用
- [ ] 不必要的复制，例如缺少 `std::move` 或按引用传参

**完整指南：** [C++ 检视指南](cpp.md)

## SQL

- [ ] 通过字符串拼接查询，存在 SQL 注入风险；应使用参数化查询
- [ ] 筛选列或关联列缺少索引
- [ ] 使用 `SELECT *`，而非明确指定列
- [ ] 存在 N+1 查询模式
- [ ] 对大表查询缺少 `LIMIT`
- [ ] 未正确处理 `NULL` 比较，例如混淆 `IS NULL` 与 `= NULL`
- [ ] 相关操作缺少事务
- [ ] 使用了错误的 JOIN 类型
- [ ] 不同数据库的排序规则或大小写敏感性带来意外行为，例如 MySQL 与 Postgres 的默认差异
- [ ] 日期与时区处理错误，例如无时区时间戳、服务器本地 `NOW()`、夏令时

**另见：** [安全检视指南](security-review-guide.md)中的 SQL 注入防护。

## API 设计

- [ ] 资源命名不一致
- [ ] HTTP 方法使用不当，例如对幂等操作使用 POST
- [ ] 列表接口缺少分页
- [ ] 状态码不正确
- [ ] 缺少限流
- [ ] 缺少输入校验和净化
- [ ] 仅信任客户端校验

## 测试

- [ ] 测试实现细节而非行为
- [ ] 缺少边界用例
- [ ] 测试不稳定，结果不确定
- [ ] 测试依赖外部系统，却没有使用模拟对象
- [ ] 缺少负向测试，即异常场景测试
- [ ] 测试准备过程过于复杂
