# Java 8 / 旧版技术栈代码检视指南

适用于仍使用 **Java 8** 及相关旧版技术栈（Spring Boot 2.x、`javax.*`、Hibernate 5）的代码仓。**不要**要求这些变更采用 Java 17/21 特性，例如 record、文本块、虚拟线程或 `ProblemDetail`。

> 对现代技术栈（Java 17/21 + Spring Boot 3），请使用 [Java 指南](java.md)。

## 目录

- [何时使用本指南](#何时使用本指南)
- [Lambda 与函数式接口](#lambda-与函数式接口)
- [Stream API](#stream-api)
- [Optional](#optional)
- [日期时间 API（`java.time`）](#日期时间-apijavatime)
- [并发：线程池与 CompletableFuture](#并发线程池与-completablefuture)
- [Spring Boot 2](#spring-boot-2)
- [JPA / Hibernate 5](#jpa--hibernate-5)
- [异常处理](#异常处理)
- [测试](#测试)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## 何时使用本指南

| 场景 | 应加载的指南 |
|----------|------|
| Java 8 / 11，不使用现代语法；Spring Boot 2.x、`javax.persistence` | **本文件** |
| Java 17/21、Spring Boot 3、`jakarta.*`、虚拟线程 | [java.md](java.md) |
| 从 Boot 2 迁移至 Boot 3 | 同时使用：本指南检查旧版陷阱，`java.md` 检查目标技术栈 |

选择指南前，检查 `pom.xml` / `build.gradle` 中的 `java.version`、Spring Boot 版本，以及使用的是 `javax` 还是 `jakarta` 包名。

---

## Lambda 与函数式接口

### 保持简短，优先使用方法引用

```java
// ❌ 过长的 lambda 难以阅读、测试和调试
users.stream().forEach(u -> {
    // 数十行业务逻辑……
});

// ✅ 提取方法，或使用方法引用
users.forEach(this::processUser);
```

### 优先使用 JDK 函数式接口

```java
// ❌ 不必要的自定义函数式接口
@FunctionalInterface
interface UserCallback {
    void accept(User u);
}

// ✅ 使用 Consumer / Function / Predicate / Supplier / BiFunction 等
void process(Consumer<User> callback) { ... }
```

### 捕获的变量必须为事实上的 final

```java
// ❌ 修改捕获的变量会导致编译错误，或迫使使用 Atomic/数组绕过限制
int sum = 0;
list.forEach(n -> sum += n); // 无法编译

// ✅ 使用流归约，或显式的可变累加器类型
int sum = list.stream().mapToInt(Integer::intValue).sum();
```

---

## Stream API

### 不要强行用 Stream 替代简单循环

```java
// ❌ 仅执行副作用，Stream 没有带来价值
items.stream().forEach(item -> process(item));

// ✅ 普通 for-each 更清晰
for (Item item : items) {
    process(item);
}
```

### Java 8 使用 Collectors 收集结果

```java
// ❌ Stream.toList() 需要 Java 16+，Java 8 不可用
list.stream().map(...).toList();

// ✅ Java 8
List<Dto> result = list.stream()
    .map(...)
    .collect(Collectors.toList());
```

注意：`Collectors.toList()` 不保证返回不可变列表。需要不可修改列表时，使用 `Collections.unmodifiableList(...)` 包装，或使用 Guava / `List.copyOf`；后者要求较新的 JDK。

### Collectors.toMap 的两个典型陷阱

```java
// ❌ 空值导致 NPE（内部使用禁止空值的 Map.merge）
Map<Long, String> map = users.stream()
    .collect(Collectors.toMap(User::getId, User::getNickname)); // nickname 可能为 null

// ✅ 先过滤，或显式处理空值
Map<Long, String> map = users.stream()
    .filter(u -> u.getNickname() != null)
    .collect(Collectors.toMap(User::getId, User::getNickname));

// ❌ 重复键导致 IllegalStateException
.collect(Collectors.toMap(User::getName, Function.identity()));

// ✅ 提供合并函数
.collect(Collectors.toMap(User::getName, Function.identity(), (a, b) -> a));
```

### 谨慎使用 parallelStream()

```java
// ❌ 小集合、I/O 或共享可变状态通常会使其更慢或不安全
list.parallelStream().forEach(sharedList::add); // race

// ❌ 在有副作用的 forEach 中写入非并发集合
map.entrySet().parallelStream().forEach(e -> result.put(e.getKey(), e.getValue()));

// ✅ 仅在 CPU 密集、没有共享可变状态且数据足够多时考虑
// ✅ 使用 toMap / toConcurrentMap 收集，不要用 forEach 写入外部 Map
Map<K, V> result = list.parallelStream()
    .collect(Collectors.toConcurrentMap(Item::getKey, Item::getValue, (a, b) -> a));
```

并行 Stream 默认使用 `ForkJoinPool.commonPool()`，会与同一进程中的其他并行任务或 CompletableFuture 任务竞争资源。

### 不要修改 Stream 数据源，避免嵌套 forEach

```java
// ❌ 流水线执行时修改数据源，会触发 ConcurrentModificationException
list.stream().peek(list::add).count();

// ❌ 嵌套 forEach 难以阅读和短路
a.forEach(x -> b.forEach(y -> ...));

// ✅ 笛卡尔积或关联式逻辑优先使用 flatMap 或普通循环
```

### 优先使用基本类型流，避免装箱

```java
// ❌ Stream<Integer> 有装箱开销
int sum = list.stream().map(Order::getAmount).reduce(0, Integer::sum);

// ✅ IntStream / LongStream / DoubleStream
int sum = list.stream().mapToInt(Order::getAmount).sum();
```

---

## Optional

**设计意图：** 用作**返回类型**，表达结果可能不存在，而非作为通用的 null 替代品。

```java
// ❌ 将 Optional 用作字段、参数或集合元素会增加序列化、反射和 API 复杂度
class User {
    private Optional<String> email;
}
void send(Optional<String> email) { ... }
Optional<List<Order>> findOrders(); // 空列表已经表示“没有”

// ✅ 仅用于返回类型；集合无元素时返回空集合
public Optional<User> findById(Long id) { ... }
public List<Order> findOrders(Long userId) { ... } // 没有元素时返回 emptyList
```

### 不要用 isPresent() 加 get() 代替空值检查

```java
// ❌ 比空值检查更冗长，get() 仍可能失败
if (userOpt.isPresent()) {
    return userOpt.get().getName();
}
return "Unknown";

// ✅ 使用函数式调用链（Java 8 可用）
return userOpt.map(User::getName).orElse("Unknown");
```

### orElse 与 orElseGet

```java
// ❌ orElse 的参数始终会被求值，即使 Optional 有值
return findUser(id).orElse(loadDefaultFromDb()); // 始终访问数据库

// ✅ 默认值计算昂贵时使用 orElseGet
return findUser(id).orElseGet(this::loadDefaultFromDb);

// ✅ 值必须存在时的写法（Java 8）
return findUser(id).orElseThrow(() -> new UserNotFoundException(id));
// 注意：无参数 orElseThrow() 需要 Java 10+；Java 8 必须提供 Supplier
```

### of 与 ofNullable；使用 flatMap 处理嵌套

```java
// ❌ of(null) 立即触发 NPE
Optional.of(possiblyNull);

// ✅
Optional.ofNullable(possiblyNull);

// ❌ map 返回 Optional，形成 Optional<Optional<T>>
optional.map(this::findOther); // findOther 返回 Optional

// ✅
optional.flatMap(this::findOther);
```

Java 8 **不支持** `Optional.stream()` / `ifPresentOrElse` / `or`，这些从 Java 9 起提供。筛选 Optional 集合时可采用以下方式：

```java
list.stream()
    .map(this::findUser)
    .filter(Optional::isPresent)
    .map(Optional::get) // filter 后可以这样使用，也可提取辅助方法
    .collect(Collectors.toList());
```

---

## 日期时间 API（java.time）

旧系统中最常见的生产隐患之一，是继续使用 `Date` / `Calendar` / `SimpleDateFormat`。

```java
// ❌ SimpleDateFormat 不是线程安全的，共享静态实例会破坏状态
private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy-MM-dd");

// ✅ DateTimeFormatter 不可变且线程安全
private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
```

### 选择正确的类型

| 类型 | 适用场景 |
|------|---------|
| `Instant` | 机器时间戳、审计、跨服务事件，基于 UTC 时间线 |
| `LocalDate` | 仅日期，例如生日、业务日期 |
| `LocalDateTime` | **没有**时区的日期时间；不要用于表示事件实际发生的时刻 |
| `ZonedDateTime` / `OffsetDateTime` | 需要时区或时区偏移的本地时间 |

```java
// ❌ 用 LocalDateTime 表示“下单时间”，跨时区或夏令时存在歧义
private LocalDateTime createdAt = LocalDateTime.now();

// ✅ 事件时间使用 Instant，仅在显示时转换时区
private Instant createdAt = Instant.now();

// ❌ now() 依赖 JVM 默认时区，CI、生产和开发电脑可能不一致
LocalDate.now();

// ✅ 显式指定 ZoneId，或注入 Clock 便于测试
LocalDate.now(ZoneOffset.UTC);
LocalDate.now(clock);
```

### 格式化陷阱

```java
// ❌ YYYY 表示基于周的年份，跨年附近可能产生错误年份
DateTimeFormatter.ofPattern("YYYY-MM-dd");

// ✅ 日历年份使用 yyyy
DateTimeFormatter.ofPattern("yyyy-MM-dd");
```

与旧 API 互操作：`date.toInstant()`、`Date.from(instant)`、`LocalDateTime.ofInstant(instant, zone)`。

---

## 并发：线程池与 CompletableFuture

Java 8 **没有虚拟线程**。I/O 密集任务需要容量合理的线程池，不宜使用 `newCachedThreadPool` 或无界队列。

```java
// ❌ 无界队列加默认拒绝策略，可能使高负载下延迟暴增或内存耗尽
ExecutorService exec = Executors.newFixedThreadPool(8); // 无界队列

// ❌ 从不关闭，导致线程泄漏
Executors.newFixedThreadPool(8).submit(task);

// ✅ 有界队列、显式拒绝策略与生命周期管理
ThreadPoolExecutor exec = new ThreadPoolExecutor(
    8, 16, 60L, TimeUnit.SECONDS,
    new ArrayBlockingQueue<>(500),
    new ThreadPoolExecutor.CallerRunsPolicy());
// 关闭顺序：shutdown → awaitTermination → shutdownNow
```

### CompletableFuture

```java
// ❌ 在公共线程池中执行 I/O（supplyAsync 未指定 Executor）
CompletableFuture.supplyAsync(() -> restTemplate.getForObject(url, Dto.class));

// ✅ Explicit I/O executor
CompletableFuture.supplyAsync(() -> callRemote(), ioExecutor);

// ❌ thenApply 返回 CF，形成嵌套的 CompletableFuture<CompletableFuture<T>>
.thenApply(id -> findAsync(id));

// ✅ 有依赖关系的异步任务使用 thenCompose
.thenCompose(id -> findAsync(id));

// ❌ 在异步回调中调用 get()/join()，造成线程池饥饿或死锁
.thenApply(x -> other.join());

// ✅ 用 allOf / thenCombine 组合，仅在边界处 join 一次
```

**超时：** Java 8 没有 `orTimeout` / `completeOnTimeout`，它们从 Java 9 起提供。可使用 `get(timeout, unit)`，或用调度器配合以异常完成的超时任务及 `applyToEither`。

**异常：** 在调用链边界添加 `exceptionally` / `handle` / `whenComplete`，避免吞掉失败。

```java
// ❌ 将共享可变的 SimpleDateFormat / HashMap 用作缓存
private static final SimpleDateFormat SDF = ...;
private final Map<String, String> cache = new HashMap<>(); // 并发写入

// ✅ 使用 ConcurrentHashMap，日期使用 java.time
private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();
```

---

## Spring Boot 2

使用的包名是 **`javax.*`**，不是 `jakarta.*`。除非变更目标就是升级到 Boot 3，否则不要要求迁移到 Jakarta。

### 依赖注入

```java
// ❌ 字段 @Autowired 难以测试，且隐藏依赖
@Autowired
private UserRepository userRepo;

// ✅ 构造函数注入（Boot 2：单构造函数可省略 @Autowired）
private final UserRepository userRepo;

public UserService(UserRepository userRepo) {
    this.userRepo = userRepo;
}
```

### 配置

```java
// ❌ 硬编码秘密信息，@Value 散布各处
@Value("${app.payment.api-key}")
private String apiKey;

// ✅ @ConfigurationProperties (Java 8 uses a class, not a record)
@ConfigurationProperties(prefix = "app.payment")
public class PaymentProperties {
    private String apiKey;
    private int timeoutMs;
    // getters / setters
}
```

通过 `@EnableConfigurationProperties` 注册。在 Boot **2.2+** 中也可使用 `@ConfigurationPropertiesScan`；`@SpringBootApplication` 默认扫描启动类所在包。

### RestTemplate 必须设置超时

默认会**无限等待**。下游卡住可能耗尽 Tomcat 或工作线程。

```java
// ❌ 直接 new RestTemplate()，未设置超时
return new RestTemplate();

// ✅ Boot 2.1+ 使用基于 Duration 的超时配置
@Bean
public RestTemplate restTemplate(RestTemplateBuilder builder) {
    return builder
        .setConnectTimeout(Duration.ofSeconds(2))
        .setReadTimeout(Duration.ofSeconds(5))
        .build();
}
```

若自定义 `ClientHttpRequestFactory`，例如 Apache HttpClient，还需在工厂中设置连接、读取及获取连接超时，否则构建器中的超时设置可能被忽略。

### 事务代理陷阱（Boot 2/3 均适用）

```java
// ❌ 同类内部调用绕过代理，@Transactional 不生效
public void create(Order o) {
    save(o); // 内部调用
}
@Transactional
public void save(Order o) { ... }

// ✅ 在公开入口设置事务边界，或拆分到另一个 bean
@Transactional
public void create(Order o) { saveInternal(o); }
```

在 `private` 方法上使用 `@Transactional` 同样无效。

---

## JPA / Hibernate 5

实体注解来自 `javax.persistence.*`。

### N+1

> 跨语言背景知识：[N+1 查询指南](cross-cutting/n-plus-one-queries.md)。

```java
// ❌ EAGER 加载，或在循环中触发惰性加载
@OneToMany(fetch = FetchType.EAGER)
private List<Order> orders;

for (User u : userRepo.findAll()) {
    u.getOrders().size(); // 惰性加载时产生 N 次查询
}

// ✅ 使用 JOIN FETCH / @EntityGraph，默认保持 LAZY
@Query("SELECT u FROM User u JOIN FETCH u.orders")
List<User> findAllWithOrders();
```

### 事务与只读设置

```java
// ❌ 在 Controller 中开启事务，或在私有方法上使用 @Transactional
// ✅ 放在公开的 Service 方法上，读操作标记为 readOnly
@Transactional(readOnly = true)
public User get(Long id) { ... }
```

### 实体与 Lombok

```java
// ❌ @Data 生成的 equals/hashCode 经常访问惰性关联
@Entity
@Data
public class User { ... }

// ✅ 使用 @Getter/@Setter；equals/hashCode 基于稳定业务键或空值安全的 id
// ⚠️ 不要包含惰性关联；未保存的新实体 id 均为 null，
//    因此仅比较 id 的实现应将其视为不相等（通常可以接受）
@Entity
@Getter
@Setter
public class User {
    @Id
    private Long id;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User)) return false;
        return id != null && id.equals(((User) o).id);
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
```

### 时间字段

Hibernate 5 支持 `java.time`，但将 `ZonedDateTime` 映射到不带时区的 `TIMESTAMP` 时，会按 JVM 时区归一化，跨地区运行可能产生偏移。优先采用以下方式：

- 存储 UTC 时间，使用 `Instant` 或 `OffsetDateTime`。
- 团队达成一致后设置 `spring.jpa.properties.hibernate.jdbc.time_zone=UTC`。
- 有计划地迁移旧 `java.util.Date` 字段；不要在新代码中继续增加 `Date` / `@Temporal`。

---

## 异常处理

Boot 2 不提供 Boot 3 对 Spring 6 `ProblemDetail` 的原生支持。使用统一的 `@ControllerAdvice`，并返回明确的 HTTP 状态码。

```java
// ❌ 吞掉异常、printStackTrace 或返回 null 来掩盖失败
try {
    userService.create(user);
} catch (Exception e) {
    e.printStackTrace();
    return null;
}

// ✅ 使用领域异常与全局处理器
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(UserNotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(UserNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(new ApiError("USER_NOT_FOUND", e.getMessage()));
    }
}
```

使用 try-with-resources（Java 7+）关闭资源，避免手写容易遗漏空值检查的 `finally { close() }`。

---

## 测试

```java
// ❌ 每个单元测试都使用 @SpringBootTest，速度慢且脆弱
@SpringBootTest
public class UserServiceTest { ... }

// ✅ 纯单元测试使用 JUnit 4/5 与 Mockito
@RunWith(MockitoJUnitRunner.class) // JUnit 4
// or @ExtendWith(MockitoExtension.class) // JUnit 5
public class UserServiceTest {
    @Mock private UserRepository repo;
    @InjectMocks private UserService service;

    @Test
    public void shouldCreateUser() { ... }
}
```

向时间敏感逻辑注入 `Clock`，使测试不依赖 `Instant.now()`。

旧版技术栈通常使用 JUnit 4；如混用 JUnit 5，每个模块保持一致的测试运行方式。

---

## 检视清单

### 版本与范围
- [ ] 已确认 Java 8 / Boot 2 / `javax.*`，不要求 Java 17+ API 或 `jakarta.*`
- [ ] 不将“使用 record、虚拟线程或文本块”列为阻塞意见

### 语言特性
- [ ] Lambda 简短，优先使用方法引用和标准函数式接口
- [ ] Stream 用于转换、筛选或归约，而非简单的副作用循环
- [ ] 使用 `Collectors.*` 收集结果，不使用 `Stream.toList()`
- [ ] `toMap` 已处理空值和重复键
- [ ] 使用 `parallelStream` 有充分依据，且不存在共享可变状态
- [ ] Optional 仅作返回类型，不滥用 `isPresent` 加 `get`；高开销默认值使用 `orElseGet`
- [ ] 日期使用 `java.time`，不共享 `SimpleDateFormat`，正确区分 `Instant` 与 `LocalDateTime`
- [ ] 日期模式使用 `yyyy`，而非基于周的 `YYYY`，除非明确需要周年份

### 并发
- [ ] 线程池有界并会关闭，I/O 不使用 `ForkJoinPool.commonPool()`
- [ ] CompletableFuture 显式指定 Executor，嵌套异步使用 `thenCompose`，并具有超时和异常处理
- [ ] 共享状态使用并发集合，没有静态可变 `DateFormat`

### Spring Boot 2 / JPA
- [ ] 使用构造器注入，通过 `@ConfigurationProperties` 管理配置
- [ ] `RestTemplate` 及 RequestFactory 设置了连接和读取超时
- [ ] `@Transactional` 用于公共入口，不存在类内自调用或私有方法导致的失效
- [ ] 不存在 N+1，实体避免 `@Data`，时间策略明确并采用 UTC
- [ ] 包名统一为 `javax.*`，不混用 javax/jakarta

### 质量
- [ ] 不吞掉异常，集中处理错误响应
- [ ] I/O 和数据库资源使用 try-with-resources
- [ ] 核心逻辑有单元测试，时间通过 `Clock` 注入

---

## 参考资料

- [JetBrains：Java 8 代码检视关注点](https://blog.jetbrains.com/upsource/2016/08/03/what-to-look-for-in-java-8-code/)
- [JDK-8148463：Collectors.toMap 遇到 null 值失败](https://bugs.openjdk.org/browse/JDK-8148463)
- [Oracle 教程：并行处理](https://docs.oracle.com/javase/tutorial/collections/streams/parallelism.html)
- [Baeldung：迁移至 Java 8 日期时间 API](https://www.baeldung.com/migrating-to-java-8-date-time-api)
- [Baeldung：CompletableFuture 与线程池](https://www.baeldung.com/java-completablefuture-threadpool)
- [Spring Boot：自定义 RestTemplate](https://docs.spring.io/spring-boot/docs/2.7.x/reference/html/io.html#io.rest-client.resttemplate)
- [Thorben Janssen：Hibernate/JPA 日期与时间](https://thorben-janssen.com/hibernate-jpa-date-and-time/)
