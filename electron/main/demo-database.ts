import { DatabaseSync } from 'node:sqlite'

export const DEMO_DATABASE_VERSION = 1

const PRODUCTS = [
  ['轻量通勤双肩包', '箱包', 399],
  ['降噪头戴耳机', '数码', 899],
  ['人体工学键盘', '数码', 649],
  ['恒温随行杯', '生活', 199],
  ['羊毛针织开衫', '服饰', 529],
  ['城市慢跑鞋', '运动', 699],
  ['桌面阅读灯', '家居', 329],
  ['便携咖啡套装', '生活', 459],
] as const

const CITIES = ['上海', '北京', '杭州', '深圳', '成都', '南京']
const CHANNELS = ['自然搜索', '广告投放', '社交媒体', '邮件营销', '直接访问']

function dateTimeDaysAgo(referenceDate: Date, daysAgo: number, hour = 10) {
  const value = new Date(referenceDate)
  value.setHours(hour, 0, 0, 0)
  value.setDate(value.getDate() - daysAgo)
  return value.toISOString().replace('T', ' ').slice(0, 19)
}

export function seedDemoDatabase(db: DatabaseSync, referenceDate = new Date()) {
  db.exec('PRAGMA foreign_keys = ON;')
  const currentVersion = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nova_demo_meta'").get()
    ? (db.prepare("SELECT value FROM nova_demo_meta WHERE key = 'version'").get() as { value?: string } | undefined)?.value
    : undefined
  if (currentVersion === String(DEMO_DATABASE_VERSION)) return false

  db.exec(`
    BEGIN;
    DROP TABLE IF EXISTS funnel_events;
    DROP TABLE IF EXISTS order_items;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS products;
    DROP TABLE IF EXISTS customers;
    DROP TABLE IF EXISTS nova_demo_meta;

    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      segment TEXT NOT NULL,
      signup_date TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      status TEXT NOT NULL,
      channel TEXT NOT NULL,
      total_amount REAL NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
    CREATE TABLE funnel_events (
      id INTEGER PRIMARY KEY,
      visitor_id TEXT NOT NULL,
      customer_id INTEGER,
      event_name TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      channel TEXT NOT NULL,
      campaign TEXT,
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    );
    CREATE INDEX idx_orders_date ON orders(order_date);
    CREATE INDEX idx_orders_customer ON orders(customer_id);
    CREATE INDEX idx_order_items_order ON order_items(order_id);
    CREATE INDEX idx_funnel_events_name_time ON funnel_events(event_name, occurred_at);
    CREATE INDEX idx_funnel_events_visitor ON funnel_events(visitor_id);
    CREATE TABLE nova_demo_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  try {
    const insertCustomer = db.prepare('INSERT INTO customers (id, name, city, segment, signup_date) VALUES (?, ?, ?, ?, ?)')
    for (let id = 1; id <= 36; id += 1) {
      insertCustomer.run(
        id,
        `示例客户 ${String(id).padStart(2, '0')}`,
        CITIES[(id - 1) % CITIES.length],
        id % 5 === 0 ? '企业客户' : id % 3 === 0 ? '高价值客户' : '普通客户',
        dateTimeDaysAgo(referenceDate, 40 + ((id * 11) % 320)).slice(0, 10),
      )
    }

    const insertProduct = db.prepare('INSERT INTO products (id, name, category, price) VALUES (?, ?, ?, ?)')
    PRODUCTS.forEach((product, index) => insertProduct.run(index + 1, ...product))

    const insertOrder = db.prepare('INSERT INTO orders (id, customer_id, order_date, status, channel, total_amount) VALUES (?, ?, ?, ?, ?, ?)')
    const insertOrderItem = db.prepare('INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?, ?)')
    let itemId = 1
    for (let orderId = 1; orderId <= 144; orderId += 1) {
      const itemCount = 1 + (orderId % 3)
      const items: Array<{ productId: number; quantity: number; price: number }> = []
      for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
        const productId = ((orderId * 3 + itemIndex * 2) % PRODUCTS.length) + 1
        items.push({ productId, quantity: 1 + ((orderId + itemIndex) % 2), price: PRODUCTS[productId - 1][2] })
      }
      const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0)
      const status = orderId % 13 === 0 ? '已退款' : orderId % 9 === 0 ? '已取消' : '已完成'
      insertOrder.run(
        orderId,
        ((orderId * 5) % 36) + 1,
        dateTimeDaysAgo(referenceDate, (orderId * 7) % 120, 9 + (orderId % 10)),
        status,
        CHANNELS[orderId % CHANNELS.length],
        total,
      )
      items.forEach((item) => {
        insertOrderItem.run(itemId, orderId, item.productId, item.quantity, item.price)
        itemId += 1
      })
    }

    const insertEvent = db.prepare('INSERT INTO funnel_events (id, visitor_id, customer_id, event_name, occurred_at, channel, campaign) VALUES (?, ?, ?, ?, ?, ?, ?)')
    let eventId = 1
    for (let visitor = 1; visitor <= 120; visitor += 1) {
      const visitorId = `visitor-${String(visitor).padStart(3, '0')}`
      const customerId = visitor <= 36 ? visitor : null
      const dayOffset = (visitor * 5) % 45
      const channel = CHANNELS[visitor % CHANNELS.length]
      const campaign = channel === '广告投放' ? ['夏日焕新', '品牌搜索', '新品首发'][visitor % 3] : null
      const stages = [
        ['访问网站', 0, true],
        ['浏览商品', 1, visitor <= 102],
        ['加入购物车', 2, visitor <= 72],
        ['开始结算', 3, visitor <= 48],
        ['完成购买', 4, visitor <= 34],
      ] as const
      stages.forEach(([eventName, hourOffset, included]) => {
        if (!included) return
        insertEvent.run(eventId, visitorId, customerId, eventName, dateTimeDaysAgo(referenceDate, dayOffset, 9 + hourOffset), channel, campaign)
        eventId += 1
      })
    }

    db.prepare("INSERT INTO nova_demo_meta (key, value) VALUES ('version', ?)").run(String(DEMO_DATABASE_VERSION))
    db.prepare("INSERT INTO nova_demo_meta (key, value) VALUES ('created_at', ?)").run(referenceDate.toISOString())
    db.exec('COMMIT')
    return true
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function ensureDemoDatabase(databasePath: string, referenceDate = new Date()) {
  const db = new DatabaseSync(databasePath)
  try {
    return seedDemoDatabase(db, referenceDate)
  } finally {
    db.close()
  }
}

export function resetDemoDatabase(databasePath: string, referenceDate = new Date()) {
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('DROP TABLE IF EXISTS nova_demo_meta')
    return seedDemoDatabase(db, referenceDate)
  } finally {
    db.close()
  }
}
