# FastAPI 代码检视指南

> 涵盖依赖注入（Depends）、Pydantic v2 校验边界、异步正确性、数据库会话生命周期与 N+1、安全，以及测试驱动的验证流程：通过进程内测试客户端复现并证明缺陷，而非凭猜测下结论。

## 目录

- [依赖注入（Depends）](#依赖注入depends)
- [Pydantic v2 模型与校验](#pydantic-v2-模型与校验)
- [异步正确性](#异步正确性)
- [数据库会话与 N+1](#数据库会话与-n1)
- [安全](#安全性)
- [测试驱动验证](#测试驱动验证)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## 依赖注入（Depends）

FastAPI 的 Depends 是保持路由轻量且可测试的连接点。此处多数问题来自把实际业务工作放在路由函数中，而非封装在依赖中。

### 将业务逻辑放入依赖或服务，保持路由轻量

```python
# ❌ 不佳：数据库访问、认证和业务规则全部写在路由函数中
@app.get("/orders/{order_id}")
async def get_order(order_id: int):
    conn = await asyncpg.connect(DATABASE_URL)  # 每次请求创建连接
    row = await conn.fetchrow("SELECT * FROM orders WHERE id = $1", order_id)
    await conn.close()
    if row is None:
        raise HTTPException(404)
    return dict(row)

# ✅ 推荐：路由声明依赖，由依赖注入提供使用连接池的会话
async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session

@app.get("/orders/{order_id}", response_model=OrderOut)
async def get_order(order_id: int, session: AsyncSession = Depends(get_session)):
    order = await session.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order
```

通过注入实现的版本，也能在测试中替换，见[测试驱动验证](#测试驱动验证)。

### yield 依赖必须清理资源，发生错误时也不例外

```python
# ❌ 不佳：没有清理，路由抛出异常时会泄漏会话
async def get_session() -> AsyncSession:
    return SessionLocal()

# ✅ 推荐：无论成功还是异常，上下文管理器都会关闭会话
async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
```

检视重点：持有数据库会话、文件句柄或锁的 yield 依赖，应通过上下文管理器或 try/finally 释放资源，避免路由异常导致资源泄漏。

### 不要为每次请求重新创建单例

```python
# ❌ 不佳：每次请求都创建 HTTP 客户端及连接池
@app.get("/proxy")
async def proxy(client: httpx.AsyncClient = Depends(lambda: httpx.AsyncClient())):
    ...

# ✅ 推荐：应用生命周期内共用一个客户端，通过引用注入
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient()
    yield
    await app.state.http.aclose()

def get_http(request: Request) -> httpx.AsyncClient:
    return request.app.state.http
```

### 优先使用 Annotated 形式及异步依赖

从 FastAPI 0.95 起，推荐通过 `Annotated[T, Depends(...)]` 声明依赖，而非使用默认参数值形式。它可跨路由复用，且有利于类型检查。也优先使用 async def 依赖：同步 def 依赖会在线程池中执行，对不涉及 I/O 的小检查而言是额外开销。

```python
# ⚠️ 旧写法：仍可运行，但不是当前惯用方式
@app.get("/items")
async def list_items(session: AsyncSession = Depends(get_session)): ...

# ✅ 推荐：使用 Annotated，一处定义，到处复用
SessionDep = Annotated[AsyncSession, Depends(get_session)]

@app.get("/items")
async def list_items(session: SessionDep): ...
```

### 用依赖检查资源存在性和权限，其结果按请求缓存

依赖适合回答“资源是否存在、调用者能否操作它”。Pydantic 校验数据形状，依赖则结合数据库校验。FastAPI 在单次请求中缓存各依赖的结果，因此串联小依赖可避免重复查询。

```python
# ✅ 推荐：小型依赖逐层组合，每次请求只解析一次 valid_post
async def valid_post(post_id: int, session: SessionDep) -> Post:
    post = await session.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return post

async def owned_post(post: Annotated[Post, Depends(valid_post)], user: CurrentUser) -> Post:
    if post.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return post

@app.delete("/posts/{post_id}", status_code=204)
async def delete_post(post: Annotated[Post, Depends(owned_post)], session: SessionDep):
    await session.delete(post)        # 已检查资源存在性与所有权
    await session.commit()
```

这也是修复[安全](#安全性)章节中认证与授权混淆问题的清晰位置：将所有权检查移入可复用的 owned_post 依赖。

---

## Pydantic v2 模型与校验

### 分离输入和输出模型，不要直接返回 ORM 对象的全部内容

```python
# ❌ 不佳：response_model 直接使用数据库模型，hashed_password 会泄露给客户端
@app.post("/users", response_model=UserTable)
async def create_user(user: UserTable):  # 还会接受客户端设置的 id、is_admin 等字段
    ...

# ✅ 推荐：不同模式明确划分信任边界
class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserOut(BaseModel):
    id: int
    email: EmailStr
    model_config = ConfigDict(from_attributes=True)  # 安全地读取 ORM 对象

@app.post("/users", response_model=UserOut, status_code=201)
async def create_user(payload: UserCreate, session: AsyncSession = Depends(get_session)):
    ...
```

response_model 不仅用于文档，也是响应过滤器：输出模型中不存在的字段会被剔除。将数据库模型直接复用为响应模型，是敏感字段泄漏的常见原因。

### 分别定义创建和更新模型

```python
# ❌ 不佳：创建与更新共用一个模式，导致 PATCH 也要求所有字段
class ItemSchema(BaseModel):
    name: str
    price: float

# ✅ 推荐：更新使用部分字段，创建要求完整请求数据
class ItemCreate(BaseModel):
    name: str
    price: float = Field(gt=0)

class ItemUpdate(BaseModel):
    name: str | None = None
    price: float | None = Field(default=None, gt=0)
```

### 在边界处校验，而非写入数据库后再校验

```python
# ❌ 不佳：负数数量未经检查就进入数据库
@app.post("/cart")
async def add_to_cart(item_id: int, quantity: int):
    await save(item_id, quantity)  # quantity = -5 被默默接受

# ✅ 推荐：在处理函数执行前由类型系统拒绝无效值
class CartLine(BaseModel):
    item_id: int
    quantity: int = Field(gt=0)

@app.post("/cart")
async def add_to_cart(line: CartLine):
    await save(line.item_id, line.quantity)
```

---

## 异步正确性

这是 FastAPI 与 Django、Flask 差异最明显、也最值得检视者关注的方面。FastAPI 通过单事件循环交错处理大量并发请求获取吞吐优势，前提是事件循环不被阻塞。一次同步调用就可能卡住所有进行中的请求。如果这种问题遍布代码仓，FastAPI 可能比按工作进程或线程处理同步请求的框架表现更差，因为共享事件循环被阻塞会扩大影响。检视时应确保循环中的操作确实非阻塞，并将兼容阻塞调用的手段视为有成本的折中。

### 不要在 async def 路由中调用阻塞代码

```python
# ❌ 不佳：事件循环上的阻塞 I/O 会冻结所有并发请求
@app.get("/report")
async def report():
    data = requests.get("https://slow-api.example.com").json()  # 阻塞式套接字调用
    time.sleep(2)                                                # 阻塞事件循环
    return data

# ✅ 推荐：await 原生异步客户端，等待期间事件循环可处理其他请求
@app.get("/report")
async def report(client: httpx.AsyncClient = Depends(get_http)):
    resp = await client.get("https://slow-api.example.com")
    return resp.json()
```

### 优先选择原生异步 SDK

解决阻塞 I/O 的优先方式通常是采用原生支持 async 的库，而非包装同步库。先选择异步客户端，线程池作为最后的兼容手段。

| 同步实现，会阻塞事件循环 | 原生异步替代实现 |
|------------------------|--------------------------|
| `requests`             | `httpx.AsyncClient`, `aiohttp` |
| `psycopg2`（同步） | `asyncpg`、SQLAlchemy 异步引擎 |
| `redis-py`（同步） | `redis.asyncio` |
| `pymongo`              | `motor` |
| `boto3`                | `aioboto3` |

若路由内部出现 asyncio.run、新建事件循环或手工启动线程，应重点关注，这通常是在勉强适配同步代码。在已运行的循环内调用 asyncio.run() 会直接抛出 RuntimeError，其他绕行方式也可能损害性能。

```python
# ❌ 不佳：从同步上下文调用异步 SDK 时自行启动循环或线程
@app.get("/users/{uid}")
def get_user(uid: int):
    return asyncio.run(repo.fetch(uid))  # 已有运行中的事件循环时会触发 RuntimeError

# ✅ 推荐：将路由声明为异步，直接 await 原生客户端
@app.get("/users/{uid}")
async def get_user(uid: int):
    return await repo.fetch(uid)
```

### 线程池容量有限，应作为兼容手段

普通 def 路由和 run_in_threadpool 不在事件循环执行；FastAPI 会将其放入**有界**工作线程池，AnyIO 默认限制为 40。对于偶发且确实无法避免的阻塞调用，这是合适的处理方式：

```python
from fastapi.concurrency import run_in_threadpool

@app.get("/legacy")
async def legacy():
    return await run_in_threadpool(blocking_library_call)  # 仅在没有异步 SDK 时使用
```

但线程池的扩展方式不同于事件循环。若所有热点路径都经过线程池，高负载下工作线程可能同时阻塞，新请求在容量上限后排队，吞吐下降。自行增加线程或进程也需评估成本；原指南特别提醒，线程过多时上下文切换与 GIL 竞争可能显著损害性能。线程池适合难以替代的少量阻塞依赖，不应代替原生异步 SDK 选型。

检视经验：低流量且没有异步替代的接口可以使用 def 路由；高流量接口若通过 def 路由或 run_in_threadpool 执行阻塞工作，应作为扩展性风险指出，并评估异步 SDK。

### CPU 密集任务交由工作进程执行

事件循环和线程池都无法直接解决 CPU 密集计算。在 GIL 限制下，同一时刻通常只有一个线程执行 Python 字节码，繁重计算即使放在线程池仍会竞争执行资源。将其交给独立进程，例如 Celery、Arq、RQ 或 multiprocessing。

```python
# ❌ 不佳：CPU 密集任务占满一个工作进程，降低所有请求的吞吐量
@app.post("/render")
async def render(doc: Doc):
    return heavy_pdf_render(doc)            # 在事件循环上进行数秒的纯 CPU 计算

# ✅ 推荐：将任务排入工作进程队列，返回任务句柄
@app.post("/render", status_code=202)
async def render(doc: Doc):
    job = await queue.enqueue(heavy_pdf_render, doc)
    return {"job_id": job.id}
```

### 不要创建未等待的协程后置之不理

```python
# ❌ 不佳：协程未被 await，邮件不会发送，也没有显式错误
@app.post("/signup")
async def signup(user: UserCreate):
    send_welcome_email(user.email)  # 返回协程后被直接丢弃

# ✅ 推荐：使用 BackgroundTasks 执行响应后的工作
@app.post("/signup")
async def signup(user: UserCreate, tasks: BackgroundTasks):
    tasks.add_task(send_welcome_email, user.email)
```

BackgroundTasks 在当前进程内运行，不提供持久化和重试，仅适用于短小的即发即忘任务，例如发邮件或记录事件。长时间运行或必须可靠重试的任务，例如数据处理和支付，应进入 Celery/Arq/RQ 等任务队列。

---

## 数据库会话与 N+1

> 📖 跨语言 N+1 模式与解决方案见 [N+1 查询指南](cross-cutting/n-plus-one-queries.md)。

### 每个请求注入独立会话，不使用全局共享会话

```python
# ❌ 不佳：模块级会话被并发请求共享，不安全
session = SessionLocal()

# ✅ 推荐：通过依赖提供请求范围的会话（见上面的 get_session）
@app.get("/items")
async def list_items(session: AsyncSession = Depends(get_session)):
    ...
```

### 预加载关联，避免 N+1

```python
# ❌ 不佳：先查询订单，再为每个订单查询客户
orders = (await session.execute(select(Order))).scalars().all()
return [{"id": o.id, "customer": o.customer.name} for o in orders]  # N+1

# ✅ 推荐：通过预加载关联数据，在一次查询中完成
stmt = select(Order).options(selectinload(Order.customer))
orders = (await session.execute(stmt)).scalars().all()
return [{"id": o.id, "customer": o.customer.name} for o in orders]
```

异步 SQLAlchemy 在会话外访问延迟加载属性时，常会抛出异常，而非静默查询；设计问题仍相同。关注循环内访问关联却没有 options(...) 预加载的情况。

### 列表接口分页

```python
# ❌ 不佳：返回所有记录，表越大性能越差
@app.get("/users")
async def list_users(session: AsyncSession = Depends(get_session)):
    return (await session.execute(select(User))).scalars().all()

# ✅ 推荐：分页并设置合理的数量上限
@app.get("/users", response_model=list[UserOut])
async def list_users(
    session: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
):
    stmt = select(User).limit(limit).offset(offset)
    return (await session.execute(stmt)).scalars().all()
```

### 在 SQL 中聚合和关联，而非在 Python 中循环处理

处理器将所有行读入内存，再循环分组、计数或关联，等于把数据库仅当作存储。应将此类操作下推数据库，集合运算通常更快，传输数据也更少。

```python
# ❌ 不佳：取回所有订单后在 Python 中按客户汇总
orders = (await session.execute(select(Order))).scalars().all()
totals: dict[int, float] = {}
for o in orders:
    totals[o.customer_id] = totals.get(o.customer_id, 0) + o.amount

# ✅ 推荐：由数据库完成分组与求和
stmt = select(Order.customer_id, func.sum(Order.amount)).group_by(Order.customer_id)
totals = dict((await session.execute(stmt)).all())
```

---

## 安全性

### 声明认证依赖，不等于执行了授权检查

这是高价值检视点：`Depends(get_current_user)` 只能证明调用者是谁，**不能**证明其有权访问当前资源。

```python
# ❌ 不佳：任意已认证用户都能删除其他用户的文档
@app.delete("/documents/{doc_id}")
async def delete_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    doc = await session.get(Document, doc_id)
    await session.delete(doc)            # 从未检查 doc.owner_id == user.id
    await session.commit()

# ✅ 推荐：修改前验证所有权
@app.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    doc = await session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Not found")
    if doc.owner_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    await session.delete(doc)
    await session.commit()
```

[测试驱动验证](#测试驱动验证)章节通过失败测试复现此问题。

### SQL 参数化，绝不用 f-string 插入用户输入

> **跨语言 SQL 注入防护详见 [SQL Injection Prevention Guide](cross-cutting/sql-injection-prevention.md)**，含 Python/Java/Go/Node.js/PHP/C# 示例及 ORM 不安全用法。

### CORS 不要同时开放凭据与通配来源

```python
# ❌ 不佳：通配来源与凭据同时启用不安全，浏览器也会拒绝
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)

# ✅ 推荐：允许凭据时，明确列出可信来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://app.example.com"],
    allow_credentials=True,
)
```

同时检查：秘密信息从配置或环境变量读取而非硬编码；HTTPException 不泄漏堆栈、SQL 等内部细节；认证接口具有速率限制。

---

## 测试驱动验证

> 借鉴测试驱动开发的原则：没有观察到测试因目标问题而失败，就无法确认它测对了内容。对代码 Agent 尤其如此：Agent 可能误读控制流、臆测不存在的保证，或为预设结论寻找理由，所以“看起来安全”本身不足为据。可执行测试提供可以直接核验的结果，不取决于推理有多自信。通过复现验证判断，才能把猜测转成证据。

自然语言检视意见，例如“这里可能允许用户删除别人的数据”，仍是待验证假设。FastAPI 可低成本验证：基于 ASGITransport 的 httpx.AsyncClient 在进程内运行应用，app.dependency_overrides 则能替换认证和数据库依赖，无需修改内部实现。Agent 应通过复现确认问题。

### 用失败测试复现疑似缺陷，确认红灯阶段

假设怀疑上面的 DELETE /documents/{doc_id} 路由未检查所有权。编写断言**安全行为**的测试，运行并观察其失败，这才是证据。

```python
# test_document_authorization.py
import pytest
from httpx import AsyncClient, ASGITransport
from fastapi import Header
from app.main import app
from app.deps import get_current_user, get_session

# 准备两个用户，依赖替换根据测试请求头选择其中一个。
USERS = {"alice": User(id=1, email="alice@example.com"),
         "bob":   User(id=2, email="bob@example.com")}

def fake_current_user(x_test_user: str = Header(default="alice")) -> User:
    return USERS[x_test_user]

@pytest.mark.asyncio
async def test_user_cannot_delete_another_users_document(session):  # 异步测试夹具
    # 准备：文档归 Alice（id=1）所有
    session.add(Document(id=10, owner_id=1, title="Alice's doc"))
    await session.commit()

    app.dependency_overrides[get_current_user] = fake_current_user
    app.dependency_overrides[get_session] = lambda: session

    # 执行：Bob 尝试删除 Alice 的文档
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.delete("/documents/10", headers={"X-Test-User": "bob"})

    # 断言预期的安全行为
    assert resp.status_code == 403

    app.dependency_overrides.clear()
```

先在未修复代码上运行，确认失败由目标缺陷引起，而非拼写错误：

```bash
$ pytest test_document_authorization.py
FAILED  assert 204 == 403
#       上方结果说明接口替 Bob 删除了 Alice 的文档，确认存在漏洞
```

`204 == 403` 的断言失败，而非导入错误或 404，说明应被拒绝的操作实际成功，使检视结论可信。随后[安全](#安全性)章节中的修复应让测试通过：

```bash
$ pytest test_document_authorization.py
PASSED
```

将此测试附在检视意见中。它既记录漏洞、验证修复，也防止回归，比单纯建议“考虑检查所有权”更有说服力。

### 优先使用 dependency_overrides，而非 patch/mock

FastAPI 依赖注入提供了测试需要的替换边界。如果不模拟所有内部细节就很难测试，通常说明耦合较重；Depends 已提供注入点，因此很少需要 unittest.mock.patch。

```python
# ❌ 不佳：修补内部实现使测试脆弱，并与导入路径耦合
@patch("app.routes.orders.asyncpg.connect")
def test_get_order(mock_connect): ...

# ✅ 推荐：用真实可运行的内存替身替换依赖
app.dependency_overrides[get_session] = lambda: in_memory_session
app.dependency_overrides[get_current_user] = lambda: test_user
```

测试之间必须重置覆盖，例如在夹具清理阶段执行 app.dependency_overrides.clear()，避免状态污染后续测试。

上述复现采用 ASGITransport、httpx.AsyncClient 和 @pytest.mark.asyncio，这是异步应用常见方式，可让测试套件与应用使用一致的事件循环，减少循环不匹配问题。同步 TestClient 更简单，适合完全同步的应用；一开始统一采用异步客户端，则能避免路由或夹具异步化后的迁移成本。

### 同时检视变更自带的测试

变更包含测试，并不自动意味着安全。对 diff 中的测试也执行以下检查：

```python
# ❌ 不佳：只测正常路径，仅证明所有条件正确时路由能运行，
#          未验证校验与授权路径。
def test_create_item():
    resp = client.post("/items", json={"name": "x", "price": 5})
    assert resp.status_code == 201

# ✅ 推荐：重点覆盖容易出错的边界与失败路径
def test_create_item_rejects_negative_price():
    resp = client.post("/items", json={"name": "x", "price": -5})
    assert resp.status_code == 422

def test_create_item_requires_authentication():
    resp = client_without_auth.post("/items", json={"name": "x", "price": 5})
    assert resp.status_code == 401
```

测试套件检视问题：

- **测试的是行为还是模拟对象？** 仅断言某个 mock 被调用，只能证明测试设置本身，不能充分验证接口。
- **是否覆盖失败路径？** 检查 401/403/404/422，不要只测 200/201。边界处更易出现缺陷。
- **模拟数据是否完整？** 外部 API 响应的 mock 若省略处理器会读取的字段，测试可能通过而生产环境失败。
- **测试是否只在实现完成后添加？** 首次运行就通过的测试尚未展示其能捕获目标问题。先复现失败再验证修复的测试，通常能提供更直接的证据。

---

## 检视清单

### 依赖注入

- [ ] 路由保持轻量，数据库访问及业务规则封装在 Depends 或服务中
- [ ] yield 依赖通过上下文管理器或 try/finally 释放资源
- [ ] HTTP 客户端、连接池等单例在 lifespan 中创建一次，而非每请求创建
- [ ] 使用 Annotated[T, Depends(...)]；不执行阻塞 I/O 的依赖采用 async def
- [ ] 存在性和权限检查位于可缓存依赖中，未在路由间复制
- [ ] 依赖可在测试中替换，路由不内联创建资源

### 校验

- [ ] 输入和输出使用独立 Pydantic 模型，不将 ORM 模型直接用作 response_model
- [ ] 已设置 response_model，防止敏感字段泄漏
- [ ] 创建和更新使用独立模型，更新支持部分字段
- [ ] gt、le、EmailStr 等约束在边界处、数据库写入前执行

### 异步

- [ ] async def 内没有 requests、time.sleep 或阻塞数据库驱动调用
- [ ] 优先使用 httpx、asyncpg、redis.asyncio 等原生异步 SDK
- [ ] 路由内不使用 asyncio.run、手工事件循环或手工线程
- [ ] run_in_threadpool / def 路由仅作为必要兼容手段，不覆盖热点路径
- [ ] CPU 密集任务交由工作进程，而非事件循环或线程池
- [ ] 无未等待协程，BackgroundTasks 仅承担短小的即发即忘任务

### 数据库

- [ ] 通过依赖提供请求级会话，没有模块级共享会话
- [ ] 循环访问的关联通过 selectinload/joinedload 预加载
- [ ] SQL 完成关联和聚合，而非 Python 循环
- [ ] 列表接口分页，并限制 limit 上限

### 安全性

- [ ] 认证依赖配套明确的**授权**检查，例如所有权或角色
- [ ] 所有 SQL 参数化，不用 f-string 插入用户输入
- [ ] CORS 不同时配置 allow_origins=["*"] 与 allow_credentials=True
- [ ] 秘密信息来自配置或环境变量，错误响应不泄漏内部细节

### 测试

- [ ] 宣称发现缺陷前，先用 TestClient/AsyncClient 失败测试复现
- [ ] 使用 dependency_overrides 而非修改内部实现，测试间重置覆盖
- [ ] 覆盖 401/403/404/422 等失败路径，而非仅正常路径
- [ ] 外部响应模拟完整，不是残缺响应
- [ ] 新测试展示了先复现失败再修复通过，而非从未失败

---

## 参考资料

- [FastAPI 官方文档](https://fastapi.tiangolo.com/)：异步、依赖和测试
- [FastAPI 最佳实践](https://github.com/zhanymkanov/fastapi-best-practices)：生产约定，包括异步路由、依赖缓存和项目结构
