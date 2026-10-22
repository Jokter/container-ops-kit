# 性能检视指南

性能审查指南，覆盖前端、后端、数据库、算法复杂度和 API 性能。

## 目录

- [前端性能 (Core Web Vitals)](#前端性能-core-web-vitals)
- [JavaScript 性能](#javascript-性能)
- [内存管理](#内存管理)
- [大 SQL 与大规格场景](#大-sql-与大规格场景)
- [数据库性能](#数据库性能)
- [API 性能](#api-性能)
- [算法复杂度](#算法复杂度)
- [性能审查清单](#性能审查清单)

---

## 前端性能 (Core Web Vitals)

### 2024 核心指标

| 指标 | 全称 | 目标值 | 含义 |
|------|------|--------|------|
| **LCP** | Largest Contentful Paint | ≤ 2.5s | 最大内容绘制时间 |
| **INP** | Interaction to Next Paint | ≤ 200ms | 交互响应时间（2024 年替代 FID）|
| **CLS** | Cumulative Layout Shift | ≤ 0.1 | 累积布局偏移 |
| **FCP** | First Contentful Paint | ≤ 1.8s | 首次内容绘制 |
| **TBT** | Total Blocking Time | ≤ 200ms | 主线程阻塞时间 |

### LCP 优化检查

```javascript
// ❌ LCP 图片懒加载 - 延迟关键内容
<img src="hero.jpg" loading="lazy" />

// ✅ LCP 图片立即加载
<img src="hero.jpg" fetchpriority="high" />

// ❌ 未优化的图片格式
<img src="hero.png" />  // PNG 文件过大

// ✅ 现代图片格式 + 响应式
<picture>
  <source srcset="hero.avif" type="image/avif" />
  <source srcset="hero.webp" type="image/webp" />
  <img src="hero.jpg" alt="Hero" />
</picture>
```

**审查要点：**
- [ ] LCP 元素是否设置 `fetchpriority="high"`？
- [ ] 是否使用 WebP/AVIF 格式？
- [ ] 是否有服务端渲染或静态生成？
- [ ] CDN 是否配置正确？

### FCP 优化检查

```html
<!-- ❌ 阻塞渲染的 CSS -->
<link rel="stylesheet" href="all-styles.css" />

<!-- ✅ 关键 CSS 内联 + 异步加载其余 -->
<style>/* 首屏关键样式 */</style>
<link rel="preload" href="styles.css" as="style" onload="this.onload=null;this.rel='stylesheet'" />

<!-- ❌ 阻塞渲染的字体 -->
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2');
}

<!-- ✅ 字体显示优化 -->
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2');
  font-display: swap;  /* 先用系统字体，加载后切换 */
}
```

### INP 优化检查

```javascript
// ❌ 长任务阻塞主线程
button.addEventListener('click', () => {
  // 耗时 500ms 的同步操作
  processLargeData(data);
  updateUI();
});

// ✅ 拆分长任务
button.addEventListener('click', async () => {
  // 让出主线程
  await scheduler.yield?.() ?? new Promise(r => setTimeout(r, 0));

  // 分批处理
  for (const chunk of chunks) {
    processChunk(chunk);
    await scheduler.yield?.();
  }
  updateUI();
});

// ✅ 使用 Web Worker 处理复杂计算
const worker = new Worker('heavy-computation.js');
worker.postMessage(data);
worker.onmessage = (e) => updateUI(e.data);
```

### CLS 优化检查

```css
/* ❌ 未指定尺寸的媒体 */
img { width: 100%; }

/* ✅ 预留空间 */
img {
  width: 100%;
  aspect-ratio: 16 / 9;
}

/* ❌ 动态插入内容导致布局偏移 */
.ad-container { }

/* ✅ 预留固定高度 */
.ad-container {
  min-height: 250px;
}
```

**CLS 审查清单：**
- [ ] 图片/视频是否有 width/height 或 aspect-ratio？
- [ ] 字体加载是否使用 `font-display: swap`？
- [ ] 动态内容是否预留空间？
- [ ] 是否避免在现有内容上方插入内容？

---

## JavaScript 性能

### 代码分割与懒加载

```javascript
// ❌ 一次性加载所有代码
import { HeavyChart } from './charts';
import { PDFExporter } from './pdf';
import { AdminPanel } from './admin';

// ✅ 按需加载
const HeavyChart = lazy(() => import('./charts'));
const PDFExporter = lazy(() => import('./pdf'));

// ✅ 路由级代码分割
const routes = [
  {
    path: '/dashboard',
    component: lazy(() => import('./pages/Dashboard')),
  },
  {
    path: '/admin',
    component: lazy(() => import('./pages/Admin')),
  },
];
```

### Bundle 体积优化

```javascript
// ❌ 导入整个库
import _ from 'lodash';
import moment from 'moment';

// ✅ 按需导入
import debounce from 'lodash/debounce';
import { format } from 'date-fns';

// ❌ 未使用 Tree Shaking
export default {
  fn1() {},
  fn2() {},  // 未使用但被打包
};

// ✅ 命名导出支持 Tree Shaking
export function fn1() {}
export function fn2() {}
```

**Bundle 审查清单：**
- [ ] 是否使用动态 import() 进行代码分割？
- [ ] 大型库是否按需导入？
- [ ] 是否分析过 bundle 大小？（webpack-bundle-analyzer）
- [ ] 是否有未使用的依赖？

### 列表渲染优化

```javascript
// ❌ 渲染大列表
function List({ items }) {
  return (
    <ul>
      {items.map(item => <li key={item.id}>{item.name}</li>)}
    </ul>
  );  // 10000 条数据 = 10000 个 DOM 节点
}

// ✅ 虚拟列表 - 只渲染可见项
import { FixedSizeList } from 'react-window';

function VirtualList({ items }) {
  return (
    <FixedSizeList
      height={400}
      itemCount={items.length}
      itemSize={35}
    >
      {({ index, style }) => (
        <div style={style}>{items[index].name}</div>
      )}
    </FixedSizeList>
  );
}
```

**大数据审查要点：**
- [ ] 列表超过 100 项是否使用虚拟滚动？
- [ ] 表格是否支持分页或虚拟化？
- [ ] 是否有不必要的全量渲染？

---

## 内存管理

### 常见内存泄漏

#### 1. 未清理的事件监听

```javascript
// ❌ 组件卸载后事件仍在监听
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);

// ✅ 清理事件监听
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

#### 2. 未清理的定时器

```javascript
// ❌ 定时器未清理
useEffect(() => {
  setInterval(fetchData, 5000);
}, []);

// ✅ 清理定时器
useEffect(() => {
  const timer = setInterval(fetchData, 5000);
  return () => clearInterval(timer);
}, []);
```

#### 3. 闭包引用

```javascript
// ❌ 闭包持有大对象引用
function createHandler() {
  const largeData = new Array(1000000).fill('x');

  return function handler() {
    // largeData 被闭包引用，无法被回收
    console.log(largeData.length);
  };
}

// ✅ 只保留必要数据
function createHandler() {
  const largeData = new Array(1000000).fill('x');
  const length = largeData.length;  // 只保留需要的值

  return function handler() {
    console.log(length);
  };
}
```

#### 4. 未清理的订阅

```javascript
// ❌ WebSocket/EventSource 未关闭
useEffect(() => {
  const ws = new WebSocket('wss://...');
  ws.onmessage = handleMessage;
}, []);

// ✅ 清理连接
useEffect(() => {
  const ws = new WebSocket('wss://...');
  ws.onmessage = handleMessage;
  return () => ws.close();
}, []);
```

### 内存审查清单

```markdown
- [ ] useEffect 是否都有清理函数？
- [ ] 事件监听是否在组件卸载时移除？
- [ ] 定时器是否被清理？
- [ ] WebSocket/SSE 连接是否关闭？
- [ ] 大对象是否及时释放？
- [ ] 是否有全局变量累积数据？
```

### 检测工具

| 工具 | 用途 |
|------|------|
| Chrome DevTools Memory | 堆快照分析 |
| MemLab (Meta) | 自动化内存泄漏检测 |
| Performance Monitor | 实时内存监控 |

---

## 大 SQL 与大规格场景

先阅读变更涉及的调用入口、业务循环、SQL/ORM、入参校验和配置，再判断风险。以下是分析线索，不是命中即报错的规则。未找到限制时提出有依据的疑点，让开发确认。

### 大 SQL

- 看查询范围与实际用途：租户、时间、状态条件能否收敛数据；全量读取后内存筛选是否可下推；分页是否有最大页大小和稳定排序，深分页是否随偏移增长。
- 看每轮数量及次数：循环查询/N+1、超长 IN/OR、批量插入/更新/删除，以及多轮分页是否最终仍全部堆积在内存。
- 看排序、聚合、多表关联的输入量；结合可获得的表结构、索引、数据库类型及执行计划判断。没有索引资料时不得断言无索引或一定全表扫描。
- 看事务覆盖的数据量、锁持有时间和批次边界。建议分批时说明事务原子性、重复处理或遗漏的语义是否需要保留。
- SELECT *、函数条件、模糊查询都不是独立的缺陷结论；LIMIT 也不能证明扫描或排序成本一定小。只有看到具体放大路径或不必要开销时才提出意见。
- 不把循环查询机械替换为一个无限增长的 IN，也不把串行调用直接改为无限并发；建议同时检查批次与并发上限。

示例意见：
> 这里按租户读取全部历史任务后在内存中筛选，本次调用链未看到数量限制。历史任务增长时可能返回较多数据，请确认任务量是否有上限，是否需要下推筛选并分批读取。

### 大规格

沿“入口 → 遍历/分页 → 查询或远程调用 → 结果汇总”推导增长方式：

- 调用量：外层租户/资源数 × 内层任务数 × 每项调用次数；重试、周期调度及多实例是否进一步放大。
- 并发与排队：Promise.all、线程池、异步任务是否有界，连接池是否只是限制执行而仍允许无界排队，取消/超时后任务是否继续占用资源。
- 内存：全量读取、对象复制、序列化、集合累计、缓存条目是否随规模增长，分页结果是否被再次合并为全量。
- 耗时：串行远程调用、嵌套查找、逐条写入是否随规模放大；任务执行超过调度周期时是否会叠加。
- 保护：核查入口限制、批次上限、限流/背压及下游容量。已有有效保护时不重复提醒；上限未知时明确请开发确认。

可以用变量说明增长关系；假设数量必须标为假设，不得编造生产规模、单条耗时、内存大小或性能测试结论。小而固定的集合不因嵌套循环就要求重构。

示例意见：
> 这里为全部资源同时发起详情请求，未看到并发限制。资源较多时可能集中占用连接并增加下游压力，请确认最大规格下的资源数量，以及调用层是否已有统一限流。

---

## 数据库性能

### N+1 查询问题

```python
# ❌ N+1 问题 - 1 + N 次查询
users = User.objects.all()  # 1 次查询
for user in users:
    print(user.profile.bio)  # N 次查询（每个用户一次）

# ✅ select_related 通过关联查询预加载单值关系
users = User.objects.select_related('profile').all()
for user in users:
    print(user.profile.bio)  # 无额外查询

# ✅ 多对多关系用 prefetch_related
posts = Post.objects.prefetch_related('tags').all()
```

```javascript
// TypeORM 示例
// ❌ N+1 问题
const users = await userRepository.find();
for (const user of users) {
  const posts = await user.posts;  // 每次循环都查询
}

// ✅ 预加载
const users = await userRepository.find({
  relations: ['posts'],
});
```

### 索引优化

```sql
-- 待确认：结合已有索引、选择性和执行计划判断查询成本
SELECT * FROM orders WHERE status = 'pending';

-- 候选方案：确认收益与写入成本后再考虑索引，不重复已有索引
CREATE INDEX idx_orders_status ON orders(status);

-- 待确认：函数条件可能影响普通索引使用，检查数据库及函数索引支持
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- ✅ 范围查询可用索引
SELECT * FROM users
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';

-- 待确认：前缀通配符可能增加匹配成本，检查索引类型和实际语义
SELECT * FROM products WHERE name LIKE '%phone%';

-- 仅当业务允许前缀匹配时考虑；不得改变原有包含匹配语义
SELECT * FROM products WHERE name LIKE 'phone%';
```

### 查询优化

```sql
-- ❌ SELECT * 获取不需要的列
SELECT * FROM users WHERE id = 1;

-- ✅ 只查询需要的列
SELECT id, name, email FROM users WHERE id = 1;

-- ❌ 大表无 LIMIT
SELECT * FROM logs WHERE type = 'error';

-- ✅ 分页查询
SELECT * FROM logs WHERE type = 'error' LIMIT 100 OFFSET 0;

-- ❌ 在循环中执行查询
for id in user_ids:
    cursor.execute("SELECT * FROM users WHERE id = %s", (id,))

-- 批量查询需先去重并限制每批参数量；批次大小依据数据库限制与实测确定
for batch in bounded_batches(user_ids, batch_size):
    cursor.execute("SELECT * FROM users WHERE id IN %s", (tuple(batch),))
```

### 数据库审查清单

```markdown
重点分析（结合规模与已有保护判断）:
- [ ] 循环查询的调用次数是否随数据增长？
- [ ] 能获取的索引、条件选择性与查询用途是否匹配？
- [ ] 是否读取明显不需要的大字段或过多数据？
- [ ] 查询、批量参数、事务范围是否有合理上限？

🟡 建议检查:
- [ ] 是否使用了 EXPLAIN 分析查询计划？
- [ ] 复合索引列顺序是否正确？
- [ ] 是否有未使用的索引？
- [ ] 是否有慢查询日志监控？
```

---

## API 性能

### 分页实现

```javascript
// ❌ 返回全部数据
app.get('/users', async (req, res) => {
  const users = await User.findAll();  // 可能返回 100000 条
  res.json(users);
});

// ✅ 分页 + 限制最大数量
app.get('/users', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);  // 最大 100
  const offset = (page - 1) * limit;

  const { rows, count } = await User.findAndCountAll({
    limit,
    offset,
    order: [['id', 'ASC']],
  });

  res.json({
    data: rows,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: Math.ceil(count / limit),
    },
  });
});
```

### 缓存策略

```javascript
// ✅ Redis 缓存示例
async function getUser(id) {
  const cacheKey = `user:${id}`;

  // 1. 检查缓存
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. 查询数据库
  const user = await db.users.findById(id);

  // 3. 写入缓存（设置过期时间）
  await redis.setex(cacheKey, 3600, JSON.stringify(user));

  return user;
}

// ✅ HTTP 缓存头
app.get('/static-data', (req, res) => {
  res.set({
    'Cache-Control': 'public, max-age=86400',  // 24 小时
    'ETag': 'abc123',
  });
  res.json(data);
});
```

### 响应压缩

```javascript
// ✅ 启用 Gzip/Brotli 压缩
const compression = require('compression');
app.use(compression());

// ✅ 只返回必要字段
// 请求: GET /users?fields=id,name,email
app.get('/users', async (req, res) => {
  const fields = req.query.fields?.split(',') || ['id', 'name'];
  const users = await User.findAll({
    attributes: fields,
  });
  res.json(users);
});
```

### 限流保护

```javascript
// ✅ 速率限制
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 分钟
  max: 100,             // 最多 100 次请求
  message: { error: 'Too many requests, please try again later.' },
});

app.use('/api/', limiter);
```

### API 审查清单

```markdown
- [ ] 列表接口是否有分页？
- [ ] 是否限制了每页最大数量？
- [ ] 热点数据是否有缓存？
- [ ] 是否启用了响应压缩？
- [ ] 是否有速率限制？
- [ ] 是否只返回必要字段？
```

---

## 算法复杂度

### 常见复杂度对比

| 复杂度 | 名称 | 10 条 | 1000 条 | 100 万条 | 示例 |
|--------|------|-------|---------|----------|------|
| O(1) | 常数 | 1 | 1 | 1 | 哈希查找 |
| O(log n) | 对数 | 3 | 10 | 20 | 二分查找 |
| O(n) | 线性 | 10 | 1000 | 100 万 | 遍历数组 |
| O(n log n) | 线性对数 | 33 | 10000 | 2000 万 | 快速排序 |
| O(n²) | 平方 | 100 | 100 万 | 1 万亿 | 嵌套循环 |
| O(2ⁿ) | 指数 | 1024 | ∞ | ∞ | 递归斐波那契 |

### 代码审查中的识别

```javascript
// ❌ O(n²) - 嵌套循环
function findDuplicates(arr) {
  const duplicates = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j]) {
        duplicates.push(arr[i]);
      }
    }
  }
  return duplicates;
}

// ✅ O(n) - 使用 Set
function findDuplicates(arr) {
  const seen = new Set();
  const duplicates = new Set();
  for (const item of arr) {
    if (seen.has(item)) {
      duplicates.add(item);
    }
    seen.add(item);
  }
  return [...duplicates];
}
```

```javascript
// ❌ O(n²) - 每次循环都调用 includes
function removeDuplicates(arr) {
  const result = [];
  for (const item of arr) {
    if (!result.includes(item)) {  // includes 是 O(n)
      result.push(item);
    }
  }
  return result;
}

// ✅ O(n) - 使用 Set
function removeDuplicates(arr) {
  return [...new Set(arr)];
}
```

```javascript
// ❌ O(n) 查找 - 每次都遍历
const users = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, ...];

function getUser(id) {
  return users.find(u => u.id === id);  // O(n)
}

// ✅ O(1) 查找 - 使用 Map
const userMap = new Map(users.map(u => [u.id, u]));

function getUser(id) {
  return userMap.get(id);  // O(1)
}
```

### 空间复杂度考虑

```javascript
// ⚠️ O(n) 空间 - 创建新数组
const doubled = arr.map(x => x * 2);

// ✅ O(1) 空间 - 原地修改（如果允许）
for (let i = 0; i < arr.length; i++) {
  arr[i] *= 2;
}

// ⚠️ 递归深度过大可能栈溢出
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);  // O(n) 栈空间
}

// ✅ 迭代版本 O(1) 空间
function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}
```

### 复杂度审查问题

```markdown
💡 "这个嵌套循环的复杂度是 O(n²)，数据量大时会有性能问题"
💡 "这里在循环中使用 Array.includes()，整体最坏为 O(n²)。请确认列表上限与调用频率，规模增长时是否值得改为 Set？"
🟡 "这个递归深度可能导致栈溢出，建议改为迭代或尾递归"
```

---

## 性能审查清单

### 重点检查（先验证上下文与规模，不自动判为阻塞）

**前端：**
- [ ] LCP 图片是否懒加载？（不应该）
- [ ] 是否有 `transition: all`？
- [ ] 是否动画 width/height/top/left？
- [ ] 列表 >100 项是否虚拟化？

**后端：**
- [ ] 是否存在 N+1 查询？
- [ ] 列表接口是否有分页？
- [ ] 是否有 SELECT * 查大表？

**通用：**
- [ ] 是否有 O(n²) 或更差的嵌套循环？
- [ ] useEffect/事件监听是否有清理？

### 🟡 建议检查（重要级）

**前端：**
- [ ] 是否使用代码分割？
- [ ] 大型库是否按需导入？
- [ ] 图片是否使用 WebP/AVIF？
- [ ] 是否有未使用的依赖？

**后端：**
- [ ] 热点数据是否有缓存？
- [ ] WHERE 列是否有索引？
- [ ] 是否有慢查询监控？

**API：**
- [ ] 是否启用响应压缩？
- [ ] 是否有速率限制？
- [ ] 是否只返回必要字段？

### 🟢 优化建议（建议级）

- [ ] 是否分析过 bundle 大小？
- [ ] 是否使用 CDN？
- [ ] 是否有性能监控？
- [ ] 是否做过性能基准测试？

---

## 性能度量阈值

下表仅为讨论性能预算的示例，不是通用门禁。以项目已有 SLO、部署规格、数据量和实测为准；不得据此凭空判定代码超时或不达标。

### 前端指标

| 指标 | 好 | 需改进 | 差 |
|------|-----|--------|-----|
| LCP | ≤ 2.5s | 2.5-4s | > 4s |
| INP | ≤ 200ms | 200-500ms | > 500ms |
| CLS | ≤ 0.1 | 0.1-0.25 | > 0.25 |
| FCP | ≤ 1.8s | 1.8-3s | > 3s |
| JS 打包体积 | < 200KB | 200～500KB | > 500KB |

### 后端指标

| 指标 | 好 | 需改进 | 差 |
|------|-----|--------|-----|
| API 响应时间 | < 100ms | 100-500ms | > 500ms |
| 数据库查询 | < 50ms | 50-200ms | > 200ms |
| 页面加载 | < 3s | 3-5s | > 5s |

---

## 工具推荐

### 前端性能

| 工具 | 用途 |
|------|------|
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Core Web Vitals 测试 |
| [WebPageTest](https://www.webpagetest.org/) | 详细性能分析 |
| [webpack-bundle-analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer) | Bundle 分析 |
| [Chrome DevTools Performance](https://developer.chrome.com/docs/devtools/performance/) | 运行时性能分析 |

### 内存检测

| 工具 | 用途 |
|------|------|
| [MemLab](https://github.com/facebookincubator/memlab) | 自动化内存泄漏检测 |
| Chrome Memory Tab | 堆快照分析 |

### 后端性能

| 工具 | 用途 |
|------|------|
| EXPLAIN | 数据库查询计划分析 |
| [pganalyze](https://pganalyze.com/) | PostgreSQL 性能监控 |
| [New Relic](https://newrelic.com/) / [Datadog](https://www.datadoghq.com/) | APM 监控 |

---

## 低级别效率反模式

代码层面的效率失误，独立于架构层面的性能问题。补充 [common-bugs-checklist.md](common-bugs-checklist.md) 中已涵盖的资源管理与并发缺陷。

### 不必要的重复工作

- [ ] 同一函数 / 查询是否在同一 request/render 中被重复调用？
- [ ] 文件 / 配置是否在循环内重复读取（loop-invariant）？
- [ ] 计算结果是否可以被缓存或向下游传递？

```typescript
// ❌ loop-invariant 在循环内反复执行
for (const path of paths) {
  const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
  processFile(path, config);
}

// ✅ 提到循环外
const config = JSON.parse(fs.readFileSync("config.json", "utf-8"));
for (const path of paths) processFile(path, config);
```

### 错失的并发机会

- [ ] 独立的 async 操作是否顺序 `await`？
- [ ] 是否可以用 `Promise.all` / `asyncio.gather` / `tokio::join!` 并发？

```typescript
// ❌ 顺序 await
const a = await fetchA();
const b = await fetchB();

// ✅ 并发
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```

### 热路径膨胀

- [ ] 模块级 / import 时代码是否执行重操作（文件 I/O、网络、大对象构造）？
- [ ] per-request 路径是否有可延迟的初始化？
- [ ] 启动时代码是否阻塞首次请求？

### 无界数据结构

> 资源生命周期相关缺陷（未关闭的连接、未移除的监听器、未清除的定时器）见 [common-bugs-checklist.md → Resource Management](common-bugs-checklist.md#资源管理)。本节聚焦 *容量边界*。

- [ ] 全局 dict / list / 缓存是否有 `max-size` 或 TTL？
- [ ] 累积型数据结构（队列、日志、metrics buffer）是否有上限？
- [ ] 每请求分配的对象是否会被持久引用而无法 GC？

```python
# ❌ 无界缓存
_cache: dict[str, Any] = {}

# ✅ 有界 LRU
from functools import lru_cache

@lru_cache(maxsize=256)
def get_cached(key: str) -> Any:
    return expensive_computation(key)
```

---

## 参考资源

- [核心 Web 指标：web.dev](https://web.dev/articles/vitals)
- [优化核心 Web 指标：Vercel](https://vercel.com/guides/optimizing-core-web-vitals-in-2024)
- [MemLab 内存分析工具：Meta 工程团队](https://engineering.fb.com/2022/09/12/open-source/memlab/)
- [大 O 复杂度速查表](https://www.bigocheatsheet.com/)
- [N+1 查询问题：Stack Overflow](https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem-in-orm-object-relational-mapping)
- [API 性能优化](https://algorithmsin60days.com/blog/optimizing-api-performance/)
