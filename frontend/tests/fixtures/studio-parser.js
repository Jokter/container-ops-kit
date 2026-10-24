import {parse,stringify} from 'yaml';
window.__fixtureYaml={parse,stringify};
import {builtinDefinitions} from '../../../backend-ts/src/modules/tools/builtins.ts';
import {parseFrame,validateFields} from '../../../backend-ts/src/modules/tools/parser.ts';
window.__fixtureBinlog={builtinDefinitions,parseFrame,validateFields};

window.Buffer={from(hex){return {toString(){return String.fromCharCode(...(hex.match(/../g)||[]).map(v=>parseInt(v,16)))}}}};
