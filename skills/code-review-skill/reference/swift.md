# Swift 代码检视指南

面向现代 Swift（5.9+/6）的代码检视清单，涵盖 SwiftUI、Swift 并发和 Swift API 设计规范。

## 快速检视清单

### 必查项目
- [ ] 是否使用安全解包，避免强制解包 `!` 和 `try!`
- [ ] 捕获 `self` 的闭包是否使用 `[weak self]` 避免循环引用
- [ ] 是否有意识地选择值类型或引用类型，即 struct 或 class
- [ ] 是否通过 `throws`/`Result` 传播错误，而非吞掉错误
- [ ] 并发边界是否通过 `Sendable`、`@MainActor` 或 actor 避免数据竞争

### 常见问题
- [ ] 即发即忘的 `Task {}` 泄漏或从不取消
- [ ] SwiftUI 属性包装器选错，例如需要 `@StateObject` 时用了 `@ObservedObject`
- [ ] 循环中执行 O(n²) 查找，本可使用 `Set` 或 `Dictionary`
- [ ] 在 IBOutlet 之外使用隐式解包可选值（`var x: T!`）
- [ ] 访问级别过宽，例如 `internal` 足够时使用 `public`/`open`
- [ ] 命名未遵循 Swift API 设计规范

---

## 1. 可选值与解包

### 1.1 避免强制解包

```swift
// ❌ 错误：值为 nil 时会在运行时崩溃
let name = user.name!
let url = URL(string: urlString)!

// ✅ 正确：用 guard let / if let 绑定
guard let name = user.name else {
    return
}

if let url = URL(string: urlString) {
    load(url)
}
```

### 1.2 使用空值合并运算符提供默认值

```swift
// ❌ 错误：冗长且容易崩溃
let count: Int
if let c = dictionary["count"] {
    count = c
} else {
    count = 0
}

// ✅ Correct: nil-coalescing
let count = dictionary["count"] ?? 0
```

### 1.3 优先使用 guard let 提前退出

```swift
// ❌ 错误：深层嵌套，形成“厄运金字塔”
func process(_ input: String?) {
    if let input = input {
        if let value = Int(input) {
            if value > 0 {
                handle(value)
            }
        }
    }
}

// ✅ 正确：guard 使正常路径无需额外缩进
func process(_ input: String?) {
    guard let input,
          let value = Int(input),
          value > 0 else {
        return
    }
    handle(value)
}
```

### 1.4 避免隐式解包可选值

```swift
// ❌ 错误：T! 在每次访问时都隐式强制解包
class ViewModel {
    var service: NetworkService!
}

// ✅ 正确：注入非可选依赖
class ViewModel {
    private let service: NetworkService

    init(service: NetworkService) {
        self.service = service
    }
}
```

### 1.5 使用可选链及 map/flatMap

```swift
// ❌ 错误：仅为转换值而手工解包
var initial: String?
if let name = user.name {
    initial = String(name.prefix(1))
}

// ✅ 正确：可选链与 map
let initial = user.name.map { String($0.prefix(1)) }

// ✅ 正确：用 flatMap 避免双重可选值
let port: Int? = components.port.flatMap { Int(exactly: $0) }
```

---

## 2. 内存管理与循环引用

### 2.1 在逃逸闭包中使用 [weak self]

```swift
// ❌ 错误：闭包强引用 self，形成循环引用
class ImageLoader {
    var onComplete: (() -> Void)?

    func load() {
        service.fetch { data in
            self.cache = data   // 闭包持有 self
            self.onComplete?()
        }
    }
}

// ✅ 正确：弱捕获 self，并用 guard 检查
class ImageLoader {
    var onComplete: (() -> Void)?

    func load() {
        service.fetch { [weak self] data in
            guard let self else { return }
            self.cache = data
            self.onComplete?()
        }
    }
}
```

### 2.2 weak 与 unowned

```swift
// ✅ 引用可能合理变为 nil 时使用 weak
class Controller {
    weak var delegate: ControllerDelegate?
}

// ✅ 只有能够保证被捕获对象的生命周期
//    长于闭包时才使用 unowned（例如 self 严格管理闭包）。
//    对象释放后访问 unowned 会崩溃。
class Owner {
    lazy var describe: () -> String = { [unowned self] in
        self.name
    }
    let name = "owner"
}

// ❌ 错误：可能比 self 存活更久的对象使用 unowned，导致崩溃
networkClient.onResponse = { [unowned self] in self.update() }
// 此处优先使用 [weak self]，因为 self 销毁后 onResponse 仍可能触发。
```

### 2.3 打破委托的循环引用

```swift
// ❌ 错误：强引用 delegate 使两个对象一直存活
protocol DataSourceDelegate: AnyObject {}

class DataSource {
    var delegate: DataSourceDelegate?   // 默认为强引用
}

// ✅ 正确：delegate 应为弱引用，协议应限制为 AnyObject
class DataSource {
    weak var delegate: DataSourceDelegate?
}
```

### 2.4 作为属性保存的闭包

```swift
// ❌ 错误：存储的闭包强引用 self，形成永久循环
class Timer {
    var tick: (() -> Void)!
    func configure() {
        tick = { self.count += 1 }
    }
    var count = 0
}

// ✅ 正确：引用 self 的存储闭包使用弱捕获
class Timer {
    var tick: (() -> Void)?
    func configure() {
        tick = { [weak self] in self?.count += 1 }
    }
    var count = 0
}
```

---

## 3. 值类型与引用类型

### 3.1 默认优先使用结构体

```swift
// ✅ 具有值语义的数据或模型使用 struct
struct Coordinate {
    var latitude: Double
    var longitude: Double
}

// 副本独立，没有共享可变状态，更适合多线程。
var a = Coordinate(latitude: 1, longitude: 2)
var b = a
b.latitude = 99   // a 不变
```

### 3.2 需要对象身份或共享状态时使用类

```swift
// ✅ 实例有独立身份、必须通过引用共享或修改，
//    或需要继承与 Objective-C 互操作时，使用 class。
final class DatabaseConnection {
    private(set) var isOpen = false
    func open() { isOpen = true }
}

// 两个引用指向同一个连接。
let conn1 = DatabaseConnection()
let conn2 = conn1
conn1.open()
// conn2.isOpen == true
```

### 3.3 无需继承的类标记为 final

```swift
// ❌ 错误：无意中允许继承，导致分派较慢且 API 脆弱
class UserViewModel {}

// ✅ 正确：final 支持静态分派，并明确设计意图
final class UserViewModel {}
```

### 3.4 留意结构体内的引用类型

```swift
// ❌ 意外行为：struct 副本仍共享内部 class 实例
final class Box { var value = 0 }
struct Container { var box = Box() }

var x = Container()
var y = x
y.box.value = 42   // x.box.value 也变成 42（共享引用！）

// ✅ 正确：整个结构都使用值语义，或有意识地实现写时复制
struct Container {
    var value = 0   // 普通值类型，各副本独立
}
```

---

## 4. 错误处理

> 📖 跨语言错误处理原则见[错误处理指南](cross-cutting/error-handling-principles.md)。

### 4.1 避免 try! 和 try?

```swift
// ❌ 错误：try! 遇到任何抛出的错误都会崩溃
let data = try! Data(contentsOf: url)

// ❌ 通常不合适：try? 静默丢弃错误及原因
let data = try? Data(contentsOf: url)   // data 为 nil，但丢失了失败原因

// ✅ 正确：传播错误，或使用 do-catch 处理
do {
    let data = try Data(contentsOf: url)
    process(data)
} catch {
    log.error("failed to read \(url): \(error)")
}
```

### 4.2 定义有意义的错误类型

```swift
// ✅ 推荐：用 Error 枚举准确表达失败类型
enum NetworkError: Error {
    case invalidURL
    case unauthorized
    case server(statusCode: Int)
    case decoding(underlying: Error)
}

func fetch(_ path: String) throws -> Data {
    guard let url = URL(string: path) else {
        throw NetworkError.invalidURL
    }
    // ...
}
```

### 4.3 使用 Result 保存结果或表示延迟处理的结果

```swift
// ✅ Result 适合回调边界，或需要保存结果的场景
func load(completion: @escaping (Result<User, NetworkError>) -> Void) {
    // completion(.success(user)) 或 completion(.failure(.unauthorized))
}

// ✅ 根据需要在 Result 与 throws 之间转换
let user = try result.get()
```

### 4.4 指定抛出错误的类型（Swift 6）

```swift
// ✅ 完全明确错误类型时，可用类型化 throws 限定它。
//    适合封闭且可穷举的错误领域；可能增加新错误的库 API，
//    优先使用未指定类型的 `throws`。
func parse(_ raw: String) throws(ParsingError) -> Token {
    guard let token = Token(raw) else {
        throw ParsingError.malformed
    }
    return token
}

do {
    let token = try parse(input)
} catch {
    // 编译期已知 `error` 为 ParsingError
    handle(error)
}
```

### 4.5 避免没有附加价值的捕获后重新抛出

```swift
// ❌ 错误：catch 没有增加价值，却掩盖了错误轨迹
do {
    try work()
} catch {
    throw error   // pointless
}

// ✅ 正确：仅在补充上下文或恢复时捕获
do {
    try work()
} catch {
    throw AppError.workFailed(underlying: error)
}
```

---

## 5. Swift 并发

> 📖 跨语言并发模式见[异步与并发指南](cross-cutting/async-concurrency-patterns.md)。

### 5.1 优先使用 async/await，避免嵌套回调

```swift
// ❌ 错误：回调层层嵌套，错误处理分散
func loadProfile(completion: @escaping (Result<Profile, Error>) -> Void) {
    fetchUser { userResult in
        switch userResult {
        case .success(let user):
            fetchAvatar(user) { avatarResult in /* ... */ }
        case .failure(let error):
            completion(.failure(error))
        }
    }
}

// ✅ 正确：线性的 async/await
func loadProfile() async throws -> Profile {
    let user = try await fetchUser()
    let avatar = try await fetchAvatar(user)
    return Profile(user: user, avatar: avatar)
}
```

### 5.2 UI 状态使用 @MainActor

```swift
// ❌ 错误：从后台上下文修改 UI 状态，导致数据竞争或崩溃
func refresh() async {
    let items = try? await api.load()
    self.items = items ?? []   // 可能在非主线程运行
}

// ✅ 正确：将面向 UI 的类型隔离到主 actor
@MainActor
final class FeedViewModel: ObservableObject {
    @Published var items: [Item] = []

    func refresh() async {
        let loaded = (try? await api.load()) ?? []
        items = loaded   // 保证在主 actor 上运行
    }
}
```

### 5.3 使用 actor 保护可变状态

```swift
// ❌ 错误：共享可变状态未同步，导致数据竞争
final class Counter {
    var value = 0
    func increment() { value += 1 }
}

// ✅ 正确：actor 串行化对自身可变状态的访问
actor Counter {
    private(set) var value = 0
    func increment() { value += 1 }
}

let counter = Counter()
await counter.increment()   // 访问需要 await，并按顺序执行
```

### 5.4 共享类型遵循 Sendable

```swift
// ❌ 错误：跨 actor 传递不符合 Sendable 的类（Swift 6 会报错）
final class Config {        // 可变，不符合 Sendable
    var retries = 3
}

// ✅ 正确：共享类型实现 Sendable，优先使用不可变值类型
struct Config: Sendable {
    let retries: Int
}

// ✅ 引用类型使用 final 与不可变存储属性，
//    只有手工同步时才使用 @unchecked Sendable。
final class Cache: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: Data] = [:]
    // 所有访问都受锁保护
}
```

### 5.5 处理任务取消

```swift
// ❌ 错误：忽略取消，视图消失后仍继续工作
func search(_ query: String) async -> [Result] {
    var results: [Result] = []
    for page in 0..<100 {
        results += await fetchPage(query, page)   // 永远不会停止
    }
    return results
}

// ✅ 正确：协作式检查取消状态
func search(_ query: String) async throws -> [Result] {
    var results: [Result] = []
    for page in 0..<100 {
        try Task.checkCancellation()
        results += try await fetchPage(query, page)
    }
    return results
}
```

### 5.6 避免即发即忘的任务泄漏

```swift
// ❌ 错误：非结构化 Task 未保留句柄，始终无法取消
final class ViewModel {
    func onAppear() {
        Task {
            await self.stream()   // 关闭视图后仍永久运行
        }
    }
}

// ✅ 正确：保留句柄并取消任务，或在 SwiftUI 中使用 .task
final class ViewModel {
    private var streamTask: Task<Void, Never>?

    func onAppear() {
        streamTask = Task { [weak self] in
            await self?.stream()
        }
    }

    func onDisappear() {
        streamTask?.cancel()
    }
}
```

### 5.7 使用结构化并发执行并行任务

```swift
// ❌ 错误：可并发的工作却顺序 await
let a = await loadA()
let b = await loadB()   // 先等待 A 完成

// ✅ 正确：使用 async let 并发执行
async let a = loadA()
async let b = loadB()
let (resultA, resultB) = await (a, b)

// ✅ 子任务数量动态变化时使用任务组
try await withThrowingTaskGroup(of: Item.self) { group in
    for id in ids {
        group.addTask { try await fetch(id) }
    }
    for try await item in group {
        store(item)
    }
}
```

---

## 6. SwiftUI

### 6.1 选择正确的状态包装器

```swift
// ✅ @State：由当前视图拥有的简单值类型状态
struct Toggle: View {
    @State private var isOn = false
    var body: some View { /* ... */ }
}

// ✅ @StateObject：由视图创建并拥有的引用类型模型
struct ProfileScreen: View {
    @StateObject private var model = ProfileViewModel()
    var body: some View { /* ... */ }
}

// ✅ @ObservedObject：由其他对象拥有并传入的模型
struct ProfileHeader: View {
    @ObservedObject var model: ProfileViewModel
    var body: some View { /* ... */ }
}

// ✅ @Binding：双向引用父级拥有的状态
struct SearchField: View {
    @Binding var text: String
    var body: some View { /* ... */ }
}
```

### 6.2 @StateObject 与 @ObservedObject

```swift
// ❌ 错误：对视图自行创建的对象使用 @ObservedObject。
//    SwiftUI 可能重建视图并重新实例化模型，
//    导致每次重新渲染都丢失状态。
struct CounterView: View {
    @ObservedObject var model = CounterModel()   // 意外地重新创建
}

// ✅ 正确：@StateObject 将模型生命周期绑定到视图
struct CounterView: View {
    @StateObject private var model = CounterModel()
}
```

### 6.3 保持视图身份稳定

```swift
// ❌ 错误：基于索引的 id 在数组重排时复用身份，
//    导致动画错误和状态过期。
ForEach(0..<items.count, id: \.self) { i in
    ItemRow(item: items[i])
}

// ✅ 正确：使用稳定且唯一的标识符
ForEach(items) { item in   // Item: Identifiable
    ItemRow(item: item)
}

// ✅ 使用 .id(...) 主动重置视图状态
ProfileView(user: user)
    .id(user.id)   // 每个用户对应新身份，从而获得全新状态
```

### 6.4 避免过度渲染

```swift
// ❌ 错误：单个庞大的 body 在任意变化时重新渲染所有内容
struct Dashboard: View {
    @ObservedObject var model: DashboardModel
    var body: some View {
        VStack {
            // 页头、复杂图表和列表一起重新计算
        }
    }
}

// ✅ 正确：提取子视图，仅重新渲染受影响部分。
//    每个子视图仅观察所需状态。
struct Dashboard: View {
    var body: some View {
        VStack {
            HeaderView()
            ChartView()
            ItemList()
        }
    }
}
```

### 6.5 使用 .task 执行异步工作

```swift
// ❌ 错误：在 onAppear 中启动工作，却不处理取消
.onAppear {
    Task { await model.load() }   // 视图消失时不会取消
}

// ✅ 正确：.task 绑定到视图生命周期，并自动取消
.task {
    await model.load()
}

// ✅ 输入变化时重新执行
.task(id: query) {
    await model.search(query)
}
```

---

## 7. 协议与泛型

### 7.1 面向协议设计

```swift
// ✅ 通过协议与默认实现组合行为
protocol Identifiable2 {
    var id: String { get }
}

protocol Describable {
    var description: String { get }
}

extension Describable {
    var description: String { "no description" }   // default
}
```

### 7.2 优先使用 some，而非 any

```swift
// ❌ 较慢：`any` 使用存在类型容器与动态分派
func makeShape() -> any Shape { Circle() }

// ✅ 较快：`some` 是编译期解析的不透明类型，
//    保留具体类型，支持静态分派。
func makeShape() -> some Shape { Circle() }

// 只有确实需要异构值时才使用 `any`：
let shapes: [any Shape] = [Circle(), Square()]
```

### 7.3 优先使用泛型约束，而非存在类型

```swift
// ❌ 错误：存在类型参数丢失具体类型，性能更低
func logTotal(_ items: [any Numeric]) {
    // 不便之处：具体数值类型被擦除，算术运算需要类型转换
}

// ✅ 正确：泛型约束保留完整类型信息
func total<T: Numeric>(_ items: [T]) -> T {
    items.reduce(.zero, +)
}
```

### 7.4 关联类型与主关联类型

```swift
// ✅ 主关联类型（Swift 5.7+）支持轻量约束
protocol Container<Item> {
    associatedtype Item
    var count: Int { get }
    subscript(_ index: Int) -> Item { get }
}

// 无需 where 子句即可约束元素类型：
func first(in container: some Container<Int>) -> Int {
    container[0]
}
```

---

## 8. 访问控制与 API 设计

### 8.1 使用最小必要访问级别

```swift
// ❌ 错误：全部声明为 public，将内部细节暴露为 API
public class Service {
    public var cache: [String: Data] = [:]
    public func reset() {}
}

// ✅ 正确：只暴露预期 API，其余保持隐藏
public final class Service {
    private var cache: [String: Data] = [:]
    public func reset() { cache.removeAll() }
}
```

### 8.2 private、fileprivate、internal 与 public/open

```swift
// private：仅在所属声明及其同文件扩展内可见
// fileprivate：在同一源文件内可见
// internal：在模块内可见（默认）
// public：模块外可见，但不能在模块外继承或重写
// open：模块外可见，且可在模块外继承或重写

// ✅ 用 private(set) 暴露只读状态
public final class Account {
    public private(set) var balance: Decimal = 0
}
```

### 8.3 遵循 Swift API 设计规范

```swift
// ❌ 错误：词语冗余，参数作用不明确
func insertObject(_ object: Element, atIndex index: Int)
list.removeElement(at: 0)

// ✅ 正确：调用处读起来像自然短语，省略多余词语
func insert(_ element: Element, at index: Int)
list.insert(item, at: 0)        // 读起来是“在位置 0 插入 item”
list.remove(at: 0)

// ✅ 布尔属性应读起来像断言
var isEmpty: Bool
var hasChanges: Bool
```

### 8.4 根据副作用命名方法

```swift
// ✅ 修改与非修改方法成对命名，遵循 ed/ing 规则
var sorted = array.sorted()   // 返回新值，不修改原值
array.sort()                  // 原地修改，使用祈使动词

let reversed = text.reversed()
text.reverse()
```

---

## 9. 集合与函数式风格

### 9.1 优先使用 map/filter/compactMap

```swift
// ❌ 冗长：手写循环与可变累加器
var names: [String] = []
for user in users {
    if user.isActive {
        names.append(user.name)
    }
}

// ✅ 正确：声明式转换
let names = users.filter(\.isActive).map(\.name)
```

### 9.2 使用 compactMap 去除 nil

```swift
// ❌ 错误：map 产生 [Int?]，还需要继续解包
let numbers = strings.map { Int($0) }   // [Int?]

// ✅ 正确：compactMap 去除 nil 并解包
let numbers = strings.compactMap { Int($0) }   // [Int]
```

### 9.3 避免 O(n²) 的成员检查

```swift
// ❌ 错误：Array 的 contains 为 O(n)，整个循环为 O(n*m)
let result = candidates.filter { blocked.contains($0) }   // blocked: [ID]

// ✅ 正确：Set 的成员检查为 O(1)
let blockedSet = Set(blocked)
let result = candidates.filter { blockedSet.contains($0) }
```

### 9.4 reduce 与 Dictionary 分组

```swift
// ✅ 使用 Dictionary(grouping:) 分组
let byFirstLetter = Dictionary(grouping: words) { $0.first }

// ❌ 不佳：reduce 每一步都复制时，应优先使用 reduce(into:)
let total = numbers.reduce(0) { $0 + $1 }   // 标量可以这样处理

// ✅ 累加到集合时使用 reduce(into:)，避免复制
let counts = words.reduce(into: [:]) { acc, word in
    acc[word, default: 0] += 1
}
```

### 9.5 大型序列的链式转换使用 lazy

```swift
// ❌ 错误：每一步都分配中间数组
let firstMatch = bigArray.map(expensive).filter(isValid).first

// ✅ 正确：lazy 避免中间数组，并支持提前停止
let firstMatch = bigArray.lazy.map(expensive).filter(isValid).first
```

---

## 10. 测试

### 10.1 XCTest 的准备、执行、断言结构

```swift
import XCTest
@testable import MyApp

final class PriceCalculatorTests: XCTestCase {
    func testDiscountApplied() {
        // Arrange
        let calculator = PriceCalculator(discount: 0.1)
        // Act
        let total = calculator.total(for: 100)
        // Assert
        XCTAssertEqual(total, 90, accuracy: 0.001)
    }
}
```

### 10.2 测试异步代码

```swift
// ✅ 测试方法标记为 async，并直接 await
func testFetchUser() async throws {
    let service = UserService(client: MockClient())
    let user = try await service.fetchUser(id: "42")
    XCTAssertEqual(user.id, "42")
}

// ✅ 断言异步调用抛出预期错误
func testFetchUserUnauthorized() async {
    let service = UserService(client: UnauthorizedClient())
    do {
        _ = try await service.fetchUser(id: "42")
        XCTFail("expected to throw")
    } catch NetworkError.unauthorized {
        // expected
    } catch {
        XCTFail("unexpected error: \(error)")
    }
}
```

### 10.3 通过协议注入依赖

```swift
// ✅ 依赖协议，使测试可以替换为模拟对象
protocol HTTPClient {
    func get(_ url: URL) async throws -> Data
}

struct MockClient: HTTPClient {
    var result: Result<Data, Error>
    func get(_ url: URL) async throws -> Data {
        try result.get()
    }
}
```

### 10.4 避免固定休眠，等待期望条件或结果值

```swift
// ❌ 错误：任意 sleep 使测试变慢且不稳定
func testCallback() {
    var done = false
    object.run { done = true }
    Thread.sleep(forTimeInterval: 1)
    XCTAssertTrue(done)
}

// ✅ 正确：回调 API 使用 XCTestExpectation
func testCallback() {
    let expectation = expectation(description: "callback fired")
    object.run { expectation.fulfill() }
    wait(for: [expectation], timeout: 1.0)
}

// ✅ 更好：重构为异步 API，直接 await 结果
func testCallback() async {
    let value = await object.run()
    XCTAssertEqual(value, expected)
}
```

---

## 参考资料

- [Swift API 设计规范](https://www.swift.org/documentation/api-design-guidelines/)
- [Swift 编程语言](https://docs.swift.org/swift-book/)
- [Swift 并发：官方语言手册](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/)
- [迁移至 Swift 6](https://www.swift.org/migration/documentation/migrationguide/)
- [Apple：在 SwiftUI 应用中管理模型数据](https://developer.apple.com/documentation/swiftui/managing-model-data-in-your-app)
- [Apple：自动引用计数](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/automaticreferencecounting/)
- [WWDC：Swift 面向协议编程](https://developer.apple.com/videos/play/wwdc2015/408/)
- [Swift 语言演进](https://github.com/apple/swift-evolution)
