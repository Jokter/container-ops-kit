import assert from 'node:assert/strict'
import test from 'node:test'

import {environmentOptionLabel} from '../src/environment-presentation.js'

test('环境名称与 IP 相同时只显示一次', () => {
  assert.equal(environmentOptionLabel({name: '71.26.146.142', ip: '71.26.146.142'}), '71.26.146.142')
})

test('有意义的环境名称仍同时显示 IP', () => {
  assert.equal(environmentOptionLabel({name: '生产容器环境', ip: '71.26.146.142'}), '生产容器环境 · 71.26.146.142')
})
