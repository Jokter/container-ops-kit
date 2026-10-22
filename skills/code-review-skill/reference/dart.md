# Dart / Flutter 代码检视指南

> 面向 Dart 3 和 Flutter，重点关注 Widget 重建、const 构造函数、空安全、isolate、build 中的异步操作、Riverpod/Bloc 状态管理陷阱、平台通道、键、资源释放及可测试性。本指南并非语言入门教程。

## 目录

- [Widget 重建与 const 构造函数](#widget-重建与-const-构造函数)
- [空安全与 late](#空安全与-late)
- [隔离执行单元 isolate](#隔离执行单元-isolate)
- [build 中的异步操作](#build-中的异步操作)
- [状态管理：Riverpod 与 Bloc](#状态管理riverpod-与-bloc)
- [平台通道](#平台通道)
- [键](#键)
- [资源释放与生命周期](#资源释放与生命周期)
- [可测试性](#可测试性)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## Widget 重建与 const 构造函数

只有 Element 树能跳过不必要工作时，Flutter 重建的开销才低。若 const 构造函数或独立 Widget 能保留子 Element，应指出每帧都新建子树、闭包或查询 Theme 的实现。

### 子树静态时优先使用 const 构造函数

```dart
// ❌ 不佳：父组件每次重建都会分配新的 Text 和 Icon。
Widget build(BuildContext context) {
  return Row(
    children: [
      Icon(Icons.star),
      Text('Favorites'),
    ],
  );
}

// ✅ 推荐：const 组件可复用规范化实例，并在重建时跳过。
Widget build(BuildContext context) {
  return const Row(
    children: [
      Icon(Icons.star),
      Text('Favorites'),
    ],
  );
}
```

检视问题：
- `Text`、`Icon`、`SizedBox`、具有固定内边距的 `Padding` 等叶子 Widget 是否使用 `const`？
- 父级缺少 `const` 是否阻碍了整棵子树使用 `const`？
- 是否仅因一个非常量参数，例如来自 `Theme.of` 的颜色或闭包，就使整个构造调用不能为 `const`？

### 需要隔离状态时，提取独立 Widget，而非辅助方法

返回 Widget 的私有方法会作为调用方 build 的一部分执行。它本身没有独立的 Element 身份，因此调用方重建时，返回的 Widget 也会随之重建。

```dart
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, required this.user});
  final User user;

  // ❌ 不佳：即使 `user` 不变，`_header()` 仍随 ProfilePage 重建。
  Widget _header() => Header(title: user.name);

  @override
  Widget build(BuildContext context) {
    return Column(children: [_header(), const Feed()]);
  }
}

// ✅ 推荐：独立组件拥有自己的 Element，Feed 可保持 const。
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, required this.user});
  final User user;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Header(title: user.name),
        const Feed(),
      ],
    );
  }
}
```

### 不要为派生值调用 setState

```dart
// ❌ 不佳：把派生数据存入 State，导致重新计算 getter 也需要重建。
class CartBadge extends StatefulWidget { /* ... */ }

class _CartBadgeState extends State<CartBadge> {
  int _count = 0;

  void didUpdateWidget(CartBadge old) {
    super.didUpdateWidget(old);
    setState(() => _count = widget.items.length);
  }
}

// ✅ 推荐：在 build 中计算派生值，仅在源数据变化时调用 setState。
class CartBadge extends StatelessWidget {
  const CartBadge({super.key, required this.items});
  final List<Item> items;

  @override
  Widget build(BuildContext context) {
    return Text('${items.length}');
  }
}
```

### 重建范围

- 对高层 `State` 对象调用 `setState` 会重建其子树。只提升必须共享的状态，并将高开销子组件独立提取，或用 `RepaintBoundary` 包裹。
- `ListView(children: [...])` 会构建所有子项。长列表优先使用 `ListView.builder` / `SliverList`。
- 向本可使用 const 的子组件传入新建 List/Map 或新回调实例，会破坏跳过子组件更新的机会。使用保存在 State 中的稳定回调，或通过 const / 独立 Widget 保持适当的 `Widget.canUpdate` 身份关系。

通用 UI 性能模式见[性能检视指南](performance-review-guide.md)。

---

## 空安全与 late

Dart 空安全的强度取决于代码是否留下 `!`、`late`、`as` 等缺口。应将它们视为检视信号，而不只是风格问题。

### 对编译器无法证明非空的值避免使用 !

```dart
// ❌ 不佳：非空断言掩盖潜在空值，导致运行时崩溃。
void openProfile(User? user) {
  Navigator.pushNamed(context, '/user/${user!.id}');
}

// ✅ 推荐：通过局部变量进行类型提升，或提前返回。
void openProfile(User? user) {
  final id = user?.id;
  if (id == null) return;
  Navigator.pushNamed(context, '/user/$id');
}
```

### late 可能延迟崩溃，并不能代替类型保证

没有初始化器的 `late` 在尚未赋值就首次读取时抛出 `LateInitializationError`。带初始化器的 `late final` 是惰性初始化，适合高开销且只执行一次的场景。

```dart
class Session {
  // ❌ 不佳：其他方法读取 `late` 字段，但构造函数并不保证已初始化。
  late String token;

  bool get isReady => token.isNotEmpty;
}

class Session {
  // ✅ 推荐：赋值前允许为空，通过 API 明确表示缺失状态。
  String? token;

  bool get isReady => token != null && token!.isNotEmpty;
}

class ThemeCache {
  // ✅ 推荐：带初始化表达式的惰性 `late final`，首次读取时仅计算一次。
  late final Map<String, Color> _colors = _loadColors();
}
```

检视问题：
- 是否只是为避免可空类型 `?` 或构造参数而使用 `late`？
- `late` 字段在 `initState` 赋值，但是否可能被更早触发的动画监听器或平台回调读取？
- 使用 `as Foo` 强转时，是否可以通过模式匹配 `if (x case final Foo foo)` 或 `is` 类型提升，在当前局部明确处理类型不匹配？

### 留意字段的类型提升限制

```dart
class ProfileTile extends StatelessWidget {
  const ProfileTile({super.key, required this.user});
  final User? user;

  @override
  Widget build(BuildContext context) {
    // ❌ 不佳：字段不能进行类型提升，触发 `unchecked_use_of_nullable_value` 检查。
    // return Text(user.name);

    // ✅ Good: promote a local.
    final user = this.user;
    if (user == null) return const SizedBox.shrink();
    return Text(user.name);
  }
}
```

空值相关崩溃仍然是真实崩溃。快速失败与吞掉异常的区别见[错误处理指南](cross-cutting/error-handling-principles.md)。

---

## 隔离执行单元 isolate

> 📖 跨语言并发模式：[异步与并发指南](cross-cutting/async-concurrency-patterns.md)。

Flutter UI isolate 不应执行繁重的 JSON、图像或加密计算。Dart isolate 不共享内存，消息必须满足可发送要求。

### 不要阻塞 UI isolate

```dart
// ❌ 不佳：在 UI isolate 中解析大型 JSON 会导致掉帧。
final users = (jsonDecode(raw) as List)
    .map((e) => User.fromJson(e as Map<String, dynamic>))
    .toList();

// ✅ 推荐：一次性任务使用 `Isolate.run`（Dart 2.19+）或 `compute`。
final users = await Isolate.run(() {
  return (jsonDecode(raw) as List)
      .map((e) => User.fromJson(e as Map<String, dynamic>))
      .toList();
});
```

### 消息限制

```dart
// ❌ 不佳：闭包、ReceivePort 和许多插件类型无法跨 isolate 传送。
await Isolate.run(() => widget.onParsed());

// ✅ 推荐：传送普通数据，在主 isolate 中映射回 UI 类型。
final dto = await Isolate.run(() => parseReport(bytes));
setState(() => report = Report.fromDto(dto));
```

检视问题：
- 非小规模数据的 `jsonDecode`、图像解码或加密是否在 UI isolate 中执行？
- isolate 回调是否捕获了 `BuildContext`、`State` 或插件控制器？
- 创建长期运行的 isolate 后，是否在 Widget 释放时配套执行 `kill` / `pause`？
- isolate 失败是否向上暴露，`await Isolate.run` 是否缺少异常处理？

`flutter/foundation.dart` 中的 `compute` 是轻量包装；纯 Dart 代码优先用 `Isolate.run`。两者都不是线程池，为每个小调用创建 isolate 的成本可能高于直接执行。

---

## build 中的异步操作

`build` 必须保持同步且无副作用。在其中新建 Future，会在每次重建时重新启动操作。

### 不要在 build 中启动 I/O 或新建 Future

```dart
// ❌ 不佳：每次重建都创建新 Future，之前的请求被丢弃。
Widget build(BuildContext context) {
  return FutureBuilder<Profile>(
    future: api.fetchProfile(id),
    builder: (context, snap) { /* ... */ },
  );
}

// ✅ 推荐：在 State 中缓存 Future，`id` 变化时重新请求。
class ProfileView extends StatefulWidget {
  const ProfileView({super.key, required this.id});
  final String id;
  @override
  State<ProfileView> createState() => _ProfileViewState();
}

class _ProfileViewState extends State<ProfileView> {
  late Future<Profile> _future = api.fetchProfile(widget.id);

  @override
  void didUpdateWidget(ProfileView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.id != widget.id) {
      _future = api.fetchProfile(widget.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Profile>(
      future: _future,
      builder: (context, snap) { /* ... */ },
    );
  }
}
```

为 `ProfileView` 设置 `ValueKey(id)` 也会重新挂载 State 并发起新请求。两种方式均可；若只缓存 `late final` Future 且没有 `didUpdateWidget`，id 改变后会继续使用旧结果。

同样适用于 `StreamBuilder`：不要在 build 中新建流。应在 `initState`、provider 或 Bloc 中创建一次，并在 dispose 时取消。

### await 后调用 setState 前必须检查 mounted

```dart
Future<void> _load() async {
  final data = await api.fetch();
  // ❌ 不佳：await 期间组件可能已经销毁。
  setState(() => _data = data);
}

Future<void> _load() async {
  final data = await api.fetch();
  if (!mounted) return;
  setState(() => _data = data);
}
```

异步间隔后，使用 `BuildContext` 调用 Navigator、ScaffoldMessenger 或 showDialog 之前，检查 `context.mounted`（Flutter 3.7+）。`use_build_context_synchronously` 规则防范的是崩溃，不只是风格问题。

### 不要将 build 标记为 async

```dart
// ❌ 不佳：build 不能是 async；这样无法编译，或会滥用辅助函数。
Widget build(BuildContext context) async {
  final user = await repo.user();
  return Text(user.name);
}

// ✅ 推荐：在 State 或通知器中保存异步状态，build 只负责读取。
```

在 build 中调用即发即忘的 `unawaited(load())`，仍然属于同一类问题。

---

## 状态管理：Riverpod 与 Bloc

示例采用常见的 Riverpod 和 Bloc。Provider、GetX、Signals 以及直接使用 InheritedWidget 时，也存在同样的重建范围、build 副作用和生命周期陷阱。

### Riverpod：watch 与 read，以及重建范围

```dart
class CartButton extends ConsumerWidget {
  const CartButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // ❌ 不佳：监听整个购物车，任意商品变化都会重建按钮。
    final cart = ref.watch(cartProvider);

    // ✅ 推荐：仅监听当前组件需要的字段。
    final count = ref.watch(cartProvider.select((c) => c.items.length));
    return Badge(label: Text('$count'));
  }
}
```

```dart
void onPressed() {
  // ❌ 不佳：在回调或监听器中使用 `watch`，此处不是用于重建的订阅。
  // ref.watch(cartProvider).add(item);

  // ✅ 推荐：一次性读取用 `read`，仅在组件或监听组件的 `build` 中用 `watch`/`select`。
  ref.read(cartProvider.notifier).add(item);
}
```

检视问题：
- 是否在 `initState`、手势处理器或 Provider 构造函数中调用 `ref.watch`？
- Widget 是否监听了整个大对象，而本可使用 `select` 或派生 provider？
- provider 是否在 dispose 后仍访问捕获的 ref，控制器或流是否缺少 `ref.onDispose`？
- 页面级 provider 是否缺少 `autoDispose`，导致页面退出后仍未释放？

### Bloc：create 与 value、buildWhen，以及已关闭的 Cubit

在 build 中使用 `BlocProvider(create: ...)` 是文档推荐方式：create 每个 Element 只执行一次，不会每次重建都执行；`updateShouldNotify` 不控制 create。真正的问题是在 build 中新建 Bloc 实例并传给 `BlocProvider.value`，它不接管所有权、不负责释放，而且每次重建都会得到新对象。由于 create 只捕获一次 id，父级之后传入新 id 时，除非 Element 重新挂载或显式发送更新，否则不会重新加载。

```dart
// ❌ 不佳：每次重建都创建 ProfileBloc()，而 `value` 不负责释放它。
Widget build(BuildContext context) {
  return BlocProvider.value(
    value: ProfileBloc()..add(ProfileStarted(id)),
    child: const ProfileBody(),
  );
}

// ❌ 不佳：UniqueKey 导致每次重建都重新挂载，反复执行 `create`。
Widget build(BuildContext context) {
  return BlocProvider(
    key: UniqueKey(),
    create: (_) => ProfileBloc()..add(ProfileStarted(id)),
    child: const ProfileBody(),
  );
}

// ✅ 推荐：`create` 管理一个实例，ValueKey(id) 仅在 id 变化时重新挂载。
class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      key: ValueKey(id),
      create: (_) => ProfileBloc()..add(ProfileStarted(id)),
      child: const ProfileBody(),
    );
  }
}
```

另一种方式是保留同一个 Bloc，在 `didUpdateWidget` 中检测 id 变化并发送 `ProfileRequested(id)`；不要在那里新建替代的 `ProfileBloc()`。

```dart
// ❌ 不佳：在 builder 中执行监听器工作，且每次状态变化都重建。
BlocBuilder<ProfileBloc, ProfileState>(
  builder: (context, state) {
    if (state is ProfileFailure) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ScaffoldMessenger.of(context).showSnackBar(/* ... */);
      });
    }
    return ProfileBody(state: state);
  },
)

// ✅ 推荐：副作用放在 BlocListener 中，用 buildWhen 筛选重建。
BlocConsumer<ProfileBloc, ProfileState>(
  listenWhen: (p, c) => c is ProfileFailure && p is! ProfileFailure,
  listener: (context, state) {
    final message = (state as ProfileFailure).message;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  },
  buildWhen: (p, c) => p.user != c.user || p.loading != c.loading,
  builder: (context, state) => ProfileBody(state: state),
)
```

检视问题：
- Cubit/Bloc 是否关闭？通过 `BlocProvider` 的 create/lazy 机制持有时由其负责，手工创建的 Bloc 则必须调用 close。
- 是否在 build 中发送事件？
- 状态是否缺少 Equatable / `==`，导致字段未变时每次 emit 也触发重建？
- 业务逻辑是否留在 Widget 中，例如将 `context.read<FooBloc>().add` 与解析、I/O 混合，而没有放入 Bloc？

GetX 的 Obx / GetBuilder 也不例外：同样要明确谁持有控制器、谁重建、谁负责释放。

---

## 平台通道

方法通道、事件通道和 Pigeon 同时涉及信任边界与生命周期。问题往往在运行时以“缺少插件”暴露，而非编译时报错。

```dart
// ❌ 不佳：使用无类型映射、忽略错误，并用耗时原生调用阻塞 UI isolate。
final result = await MethodChannel('app.wallet').invokeMethod('sign', {'tx': raw});
final signature = result as String;

// ✅ 推荐：使用有类型的 API（Pigeon 或封装层），处理错误，不假设运行于 UI 线程。
try {
  final signature = await walletHost.sign(SignRequest(tx: raw));
  if (!mounted) return;
  onSigned(signature);
} on PlatformException catch (e) {
  onSignFailed(e.code, e.message);
}
```

检视问题：
- 通道名是否使用 `app`、`native` 等容易冲突且没有域名前缀的通用字符串？
- 同一方法的 Android/iOS 实现是否覆盖所有参数类型及 null？
- Dart 侧是否假定插件已注册？测试、后台 isolate 和 add-to-app 引擎往往不满足此条件。
- 二进制数据是否通过 `List<int>` 反复复制，而非使用 `Uint8List` 或 Pigeon 字节类型？
- 是否在 dispose 中取消 EventChannel 订阅？
- 原生代码是否在平台主线程执行磁盘或网络操作？

平台数据应视为不可信输入，像校验网络载荷一样校验它。见[安全检视指南](security-review-guide.md)。

---

## 键

键用于跨重建保留 State / Element 身份。错误的键可能让状态附着到错误行；缺少键可能在列表重排时导致状态重置。

```dart
// ❌ 不佳：没有 key，删除或重排后 TextField 状态仍绑定到原索引。
ListView(
  children: items.map((item) => TodoRow(item: item)).toList(),
)

// ❌ 不佳：在 build 中创建 UniqueKey()，每次重建身份都变化，状态不断重置。
TodoRow(key: UniqueKey(), item: item)

// ✅ 推荐：使用模型中稳定的 id。
ListView(
  children: [
    for (final item in items)
      TodoRow(key: ValueKey(item.id), item: item),
  ],
)
```

```dart
// ❌ 不佳：在 `build` 中创建 GlobalKey，每次重建都会产生新 key，并增加 GlobalKey 开销。
Widget build(BuildContext context) {
  final key = GlobalKey<FormState>();
  return Form(key: key, child: /* ... */);
}

// ✅ 推荐：仅在确实需要 FormState 时使用 GlobalKey，并保存在 State 中。
class _EditorState extends State<Editor> {
  final _formKey = GlobalKey<FormState>();
  @override
  Widget build(BuildContext context) => Form(key: _formKey, child: /* ... */);
}
```

检视问题：
- 可重排、可滑动删除或带动画的列表，是否根据稳定模型 ID 使用 ValueKey / ObjectKey？
- 本可使用回调或 ValueNotifier 时，是否通过 GlobalKey 直接访问子组件 State？
- Widget 的 runtimeType 已能唯一标识身份时，是否仍添加通常不必要的键？

---

## 资源释放与生命周期

凡是涉及 addListener、订阅、ticker 或原生关联对象的资源，都需要配套释放。Flutter 不会自动替你处理所有资源。

```dart
class SearchField extends StatefulWidget {
  const SearchField({super.key});
  @override
  State<SearchField> createState() => _SearchFieldState();
}

class _SearchFieldState extends State<SearchField> with SingleTickerProviderStateMixin {
  late final TextEditingController _controller;
  late final AnimationController _anim;
  StreamSubscription<Query>? _sub;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
    _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 200));
    _sub = queryStream.listen((q) {
      if (mounted) _controller.text = q.text;
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _anim.dispose();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(controller: _controller);
}
```

检视问题：
- 创建的 TextEditingController、ScrollController、FocusNode、AnimationController、TabController、PageController 是否已释放？
- StreamSubscription、Timer、ChangeNotifier 监听器和 WidgetsBindingObserver 是否已取消或移除？
- AnimationController 是否使用随 State 一同结束的 TickerProvider，例如 SingleTickerProviderStateMixin，避免 vsync 泄漏？
- 在 BlocProvider/Provider 中创建的路由级控制器，是否配置 dispose 回调？
- 路由被覆盖时是否停止 Image.network、视频或相机控制器，而非仅在路由弹出时停止？

dispose 不应使用 BuildContext，因为对应元素正在卸载；也不要在此调用 setState。

---

## 可测试性

像检视产品代码一样检视测试。如果只断言一个字符串就必须加载整个 Flutter 应用，往往说明业务逻辑困在 Widget 中。

```dart
// ❌ 不佳：解析和 I/O 都写在组件中，测试需要 pump 并模拟所有依赖。
class PriceLabel extends StatelessWidget {
  const PriceLabel({super.key, required this.raw});
  final String raw;

  @override
  Widget build(BuildContext context) {
    final n = NumberFormat.simpleCurrency().parse(raw);
    return Text(n.toString());
  }
}

// ✅ 推荐：对纯函数或映射器进行单元测试，组件仅负责渲染。
String formatPrice(String raw, NumberFormat format) => format.format(format.parse(raw));

class PriceLabel extends StatelessWidget {
  const PriceLabel({super.key, required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Text(text);
}
```

```dart
// ❌ 不佳：测试依赖真实时间和网络。
testWidgets('loads profile', (tester) async {
  await tester.pumpWidget(const ProfilePage(id: '1'));
  await tester.pumpAndSettle();
  expect(find.text('Ada'), findsOneWidget);
});

// ✅ 推荐：注入替身，pump 直到受控的 Future 完成。
testWidgets('loads profile', (tester) async {
  final api = FakeProfileApi()..completeWith(Profile(name: 'Ada'));
  await tester.pumpWidget(ProfilePage(id: '1', api: api));
  await tester.pump();
  expect(find.text('Ada'), findsOneWidget);
});
```

检视问题：
- 新逻辑能否直接用 `flutter test` 测试，而无需 IntegrationTestWidgetsFlutterBinding？
- 测试及检视者需要定位的交互 Widget 是否具备 Key，且没有在 build 中随意创建 UniqueKey？
- 平台通道是否通过 TestDefaultBinaryMessengerBinding 模拟？
- 无限动画或轮询流是否导致 pumpAndSettle 始终等不到空闲？
- 测试中的 late 是否掩盖了缺失的准备步骤？

---

## 检视清单

### Widget 与重建
- [ ] 静态子树使用 const 构造函数
- [ ] 高开销子组件提取为独立 Widget，而非 `_buildFoo()` 方法
- [ ] 长列表使用惰性构建器，而非一次性创建全部 children
- [ ] 不用 setState 存储可在 build 中派生的值

### 空安全与 late
- [ ] 不用 `!` 和 `as` 压制类型系统
- [ ] late 用于惰性初始化，或确实能保证首次读取前已赋值
- [ ] 可空字段通过局部变量完成类型提升，而非直接假定非空

### isolate 与异步
- [ ] 繁重 JSON、图像或加密计算移出 UI isolate
- [ ] isolate 消息为可发送的普通数据
- [ ] build 不新建 Future/Stream，也不启动 I/O
- [ ] FutureBuilder/StreamBuilder 复用缓存的 Future/Stream，并在 ID 或输入变化时重新获取
- [ ] await 后使用 setState / BuildContext 前检查 mounted / context.mounted

### 状态管理
- [ ] ref.watch / context.watch 用于 build，read 用于回调
- [ ] 使用 select、buildWhen 缩小重建范围
- [ ] 不在 build 中创建 Bloc/Cubit/ChangeNotifier 再传给 *.value；应使用 create，并用 ValueKey(id)（不是 UniqueKey()）或 didUpdateWidget 确保新 ID 触发重新加载
- [ ] 持有控制器的 provider/Bloc 通过 autoDispose、close 等释放

### 平台、键与资源释放
- [ ] 平台通道调用处理 PlatformException 和缺少插件的情况
- [ ] 取消 EventChannel 及原生订阅
- [ ] 持有 State 的列表子项具有稳定 ValueKey，而非在 build 中创建 UniqueKey()
- [ ] 控制器、ticker 和订阅已释放，dispose 不使用 context

### 测试
- [ ] 领域逻辑无需加载 Widget 即可单元测试
- [ ] Widget 测试注入替身，不访问真实网络或平台通道
- [ ] 不对永不空闲的动画使用 pumpAndSettle

---

## 参考资料

- [Dart 语言指南：空安全](https://dart.dev/null-safety)
- [高效 Dart 编程规范](https://dart.dev/effective-dart)
- [Flutter 性能最佳实践](https://docs.flutter.dev/perf/best-practices)
- [FutureBuilder 类](https://api.flutter.dev/flutter/widgets/FutureBuilder-class.html)
- [Isolate.run](https://api.dart.dev/stable/dart-isolate/Isolate/run.html)
- [Riverpod：Ref 与 watch/read](https://riverpod.dev/docs/concepts2/refs)
- [Bloc：BlocListener 与 BlocBuilder](https://bloclibrary.dev/bloc-concepts/)
- [Key 类](https://api.flutter.dev/flutter/foundation/Key-class.html)
- [错误处理指南](cross-cutting/error-handling-principles.md)
- [异步与并发指南](cross-cutting/async-concurrency-patterns.md)
- [性能检视指南](performance-review-guide.md)
- [安全检视指南](security-review-guide.md)
