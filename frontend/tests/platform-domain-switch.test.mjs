import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {JSDOM} from 'jsdom'

const 页面路径 = new URL('../../index.html', import.meta.url)
const 页面 = await readFile(页面路径, 'utf8')

function 打开页面() {
  return new JSDOM(页面, {
    runScripts: 'dangerously',
    url: 'http://localhost/',
    beforeParse(窗口) {
      窗口.scrollTo = () => {}
    }
  })
}

test('正式页面可以在三个平台域之间切换', () => {
  const 页面实例 = 打开页面()
  const 文档 = 页面实例.window.document

  assert.deepEqual(
    [...文档.querySelectorAll('[data-platform-domain]')].map(入口 => 入口.dataset.platformDomain),
    ['container', 'virtualization', 'common']
  )

  文档.querySelector('[data-platform-domain="virtualization"]').click()
  assert.equal(文档.querySelector('.platform-placeholder h1').textContent, '虚拟化')
  assert.equal(文档.querySelector('.variant-a-nav'), null)

  文档.querySelector('[data-platform-domain="common"]').click()
  assert.equal(文档.querySelector('.platform-placeholder h1').textContent, '公共能力')

  页面实例.window.close()
})

test('切回容器化后恢复离开前的页面', () => {
  const 页面实例 = 打开页面()
  const 文档 = 页面实例.window.document

  文档.querySelector('[data-page="build"]').click()
  assert.equal(文档.querySelector('.page-head h1').textContent, '构建')

  文档.querySelector('[data-platform-domain="virtualization"]').click()
  文档.querySelector('[data-platform-domain="container"]').click()

  assert.equal(文档.querySelector('.page-head h1').textContent, '构建')
  assert.equal(文档.querySelector('[data-page="build"]').classList.contains('active'), true)

  页面实例.window.close()
})
