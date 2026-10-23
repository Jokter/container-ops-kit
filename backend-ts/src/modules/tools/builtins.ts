// Protocol definitions and sample frames supplied with the nine commands.
export const builtinDefinitions: unknown = [
  {
    "code": "0b14",
    "name": "订阅 binlog 响应（0B14）",
    "sample": "0b14000000000000000100020003",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x0B14"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他值表示失败"
      },
      {
        "offset": 4,
        "name": "featureCause",
        "type": "nest",
        "tag": "0001",
        "label": "消息上报来源特性",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "feature",
            "type": "int",
            "label": "特性标识",
            "enum": {
              "0": "联动去油",
              "1": "自适应备电",
              "2": "备电感知",
              "3": "自适应备电2.0",
              "65535": "无效值(DEV未识别)"
            },
            "desc": "4~65534为Reserved。65535表示DEV未识别到特性标识时反馈此值"
          }
        ]
      }
    ]
  },
  {
    "code": "0b16",
    "name": "退订 binlog 响应（0B16）",
    "sample": "0b16000000000000000100020003",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x0B16"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他值表示失败"
      },
      {
        "offset": 4,
        "name": "featureCause",
        "type": "nest",
        "tag": "0001",
        "label": "消息上报来源特性",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "feature",
            "type": "int",
            "label": "特性标识",
            "enum": {
              "0": "联动去油",
              "1": "自适应备电",
              "2": "备电感知",
              "3": "自适应备电2.0",
              "65535": "无效值(DEV未识别)"
            },
            "desc": "4~65534为Reserved。65535表示DEV未识别到特性标识时反馈此值"
          }
        ]
      }
    ]
  },
  {
    "code": "0b17",
    "name": "电源周期上报（0B17）",
    "sample": "0b17ba940001001e000000020000011dffffffff0000011dffffffff000014090000000000000002002c0000132c00000001000001c63231303233313156424b4e304e39303030353237000000000000000000000000000300020001000402340000000e0000000000000046000000003231303233313258425731305132313030363639000000000000007c0000000000000047000000003231303233313254424131304c39303031303537000000000000004600000000000000480000000032313032333132594d574455513530303233353300000000000000ac000000000000005a0000000032313032333133584b474455523230303230363400000000000000b7000000000000005b0000000032313032333133584b47445552313030323632370000000000000098000000000000005c0000000032313032333132594d574455514130303531373500000000000000bc0000000000000064000000003231303233313242534a434e514130303030353900000000000001b20000000000000065000000003231303233313242534a4455523230303139363900000000000001980000000000000066000000003231303233313242534a445552323030323132310000000000000190000000000000006e0000000032313032333133434b4331305133313030303834000000000000024a000000000000006f000000003231303233313251594b31304d32303031323539000000000000024d00000000000000c8000000003231303233313251465131304e31313031313637000000000000018c00000000000000c9000000003231303233313251465131304b38303030303130000000000000013800000000000000ca000000003231303233313251465131304e3131303131383300000000000001a80005000200010006001e000000030000011dffffffff0000012cffffffff0000140b0000000000000007001200010000000a0000002900000000000000020008000200030009001200010000000a000000110000000000030002000a009c00010000000a00000011000000000005000000003231303233313251465131304e3131303131363700000000000000013231303233313251465131304e3131303131383300000000000000023231303233313251465131304b38303030303130000000000000000332313032333133434b433130513331303030383400000000000000043231303233313251594b31304d3230303132353900000000000b0018000000000000000000000000000000000000000100000001",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x0B17"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 4,
        "name": "powerSupplyInfo",
        "type": "nest",
        "tag": "0001",
        "label": "电量信息",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 8,
            "name": "energySavingCause",
            "type": "long",
            "label": "基站节能原因",
            "enum": {
              "1": "XMU",
              "2": "PMU"
            },
            "desc": "1~100，22B当前网元仅上报1或2。不用于联动去油的逻辑计算，仅用于后续功能扩展"
          },
          {
            "offset": 8,
            "name": "lithiumBatteryRemainingCapacity",
            "type": "long",
            "label": "锂电电池组剩余容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "leadAcidBatteryRemainingCapacity",
            "type": "long",
            "label": "铅酸电池组剩余容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "ratedCapacityOfLithiumBattery",
            "type": "long",
            "label": "锂电电池组额定容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "仅用于收益呈现，不参与联动去油的逻辑计算。0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "ratedCapacityOfLeadAcidBattery",
            "type": "long",
            "label": "铅酸电池组额定容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "仅用于收益呈现，不参与联动去油的逻辑计算。0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "xmuPmuTotalPower",
            "type": "long",
            "label": "XMU/PMU直流输出总功率",
            "unit": "W",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值。存在tag11时，该值会被tag11中柜号是7的PmuDetail覆盖"
          },
          {
            "offset": 8,
            "name": "mainsstatus",
            "type": "long",
            "label": "市电状态",
            "enum": {
              "0": "正常",
              "1": "市电无"
            },
            "desc": "存在tag11时，该值会被tag11中柜号是7的PmuDetail覆盖"
          },
          {
            "offset": 4,
            "name": "cuurentEnergySavingLevel",
            "type": "int",
            "label": "当前节能等级",
            "enum": {
              "0": "NORMAL(正常)",
              "1": "MINOR(次要)",
              "2": "MAJOR(重要)",
              "3": "CRITICAL(紧急)"
            },
            "desc": "SRAN18.1仅使用节能等级1和节能等级0"
          }
        ]
      },
      {
        "offset": 4,
        "name": "powerInfo",
        "tag": "0002",
        "type": "nest",
        "label": "基站实时功率信息",
        "childrenLengthOffset": 4,
        "skip": true,
        "children": [
          {
            "offset": 8,
            "name": "bbuSubrackNum",
            "type": "long",
            "label": "BBU机框个数",
            "desc": "0~2。根据机框个数解析对应BBU机框的功率"
          },
          {
            "offset": 8,
            "name": "realTimePowerOfBaseSattion",
            "type": "long",
            "label": "基站实时功率值",
            "unit": "W",
            "invalidValue": 4294967295,
            "desc": "包括RRU和BBU。0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "realTimePowerOfBBU",
            "type": "long",
            "label": "BBU机框实时功率值",
            "unit": "W",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 64,
            "name": "esnOfBBU",
            "type": "hex",
            "label": "BBU机框ESN号",
            "desc": "32字节。上报此ESN号用于MAE去重"
          }
        ]
      },
      {
        "offset": 4,
        "name": "xmuNum",
        "tag": "0003",
        "type": "nest",
        "label": "XMU/PMU个数",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "totalPmuNum",
            "type": "int",
            "label": "基站正常开工的XMU/PMU个数",
            "unit": "个"
          }
        ]
      },
      {
        "offset": 4,
        "name": "rruNum",
        "tag": "0004",
        "type": "nest",
        "label": "射频RXU/RRU/AAU信息",
        "childrenLengthOffset": 4,
        "skip": true,
        "children": [
          {
            "offset": 8,
            "name": "rruNum",
            "type": "long",
            "label": "射频RXU/RRU/AAU的个数"
          },
          {
            "offset": 8,
            "name": "rruPower",
            "type": "long",
            "label": "1个RXU/RRU/AAU的功率",
            "unit": "W"
          },
          {
            "offset": 64,
            "name": "rruId",
            "type": "hex",
            "label": "射频模块RXU/RRU/AAU标识",
            "desc": "24字节，bar code"
          }
        ]
      },
      {
        "offset": 4,
        "name": "epmuNum",
        "tag": "0005",
        "type": "nest",
        "label": "EPMU个数",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "totalEpmuNum",
            "type": "int",
            "label": "基站可用的EPMU个数",
            "unit": "个"
          }
        ]
      },
      {
        "offset": 4,
        "name": "electricity",
        "tag": "0006",
        "type": "nest",
        "label": "EPMU电量信息",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 8,
            "name": "energySavingCause",
            "type": "long",
            "label": "基站节能原因",
            "enum": {
              "3": "EPMU"
            },
            "desc": "1~100，3表示EPMU"
          },
          {
            "offset": 8,
            "name": "lithiumBatteryRemainingCapacity",
            "type": "long",
            "label": "锂电电池组剩余容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "leadAcidBatteryRemainingCapacity",
            "type": "long",
            "label": "铅酸电池组剩余容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "ratedCapacityOfLithiumBattery",
            "type": "long",
            "label": "锂电电池组额定容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "仅用于收益呈现，不参与联动去油的逻辑计算。0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "ratedCapacityOfLeadAcidBattery",
            "type": "long",
            "label": "铅酸电池组额定容量",
            "unit": "Ah",
            "invalidValue": 4294967295,
            "desc": "仅用于收益呈现，不参与联动去油的逻辑计算。0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "xmuPmuTotalPower",
            "type": "long",
            "label": "EPMU直流输出总功率",
            "unit": "W",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值"
          },
          {
            "offset": 8,
            "name": "mainsstatus",
            "type": "long",
            "label": "市电状态",
            "enum": {
              "0": "正常",
              "1": "市电无"
            }
          },
          {
            "offset": 4,
            "name": "currentEnergySavingLeve",
            "type": "int",
            "label": "当前节能等级",
            "enum": {
              "0": "NORMAL(正常)",
              "1": "MINOR(次要)",
              "2": "MAJOR(重要)",
              "3": "CRITICAL(紧急)"
            },
            "desc": "SRAN18.1仅使用节能等级1和节能等级0"
          }
        ]
      },
      {
        "offset": 4,
        "name": "batteryInfo",
        "tag": "0007",
        "type": "nest",
        "label": "电池信息",
        "skip": true,
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "@batteryNumber",
            "type": "int",
            "label": "电池个数"
          },
          {
            "offset": 32,
            "name": "batteryDetail",
            "lengthKey": "batteryInfo.@batteryNumber",
            "type": "array",
            "label": "电池详细信息",
            "children": [
              {
                "offset": 8,
                "name": "cabinet",
                "type": "long",
                "label": "电池柜号"
              },
              {
                "offset": 8,
                "name": "subrack",
                "type": "long",
                "label": "电池框号"
              },
              {
                "offset": 8,
                "name": "slot",
                "type": "long",
                "label": "电池槽号"
              },
              {
                "offset": 4,
                "name": "type",
                "type": "int",
                "label": "电池类型",
                "enum": {
                  "0": "锂电池",
                  "1": "铅酸电池",
                  "2": "铅锂混搭电池"
                }
              },
              {
                "offset": 4,
                "name": "chargeStatus",
                "type": "int",
                "label": "电池充放电状态",
                "enum": {
                  "0": "均充",
                  "1": "强制均充",
                  "2": "浮充",
                  "3": "休眠",
                  "4": "放电",
                  "5": "测试中",
                  "6": "离线",
                  "7": "未知",
                  "65535": "NULL"
                }
              }
            ]
          }
        ]
      },
      {
        "offset": 4,
        "name": "featureCause",
        "type": "nest",
        "tag": "0008",
        "label": "消息上报来源特性",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "feature",
            "type": "int",
            "label": "特性标识",
            "enum": {
              "0": "联动去油",
              "1": "自适应备电",
              "2": "备电感知",
              "3": "自适应备电2.0",
              "65535": "无效值(DEV未识别)"
            },
            "desc": "4~65534为Reserved。65535表示DEV未识别到特性标识时反馈此值"
          }
        ]
      },
      {
        "offset": 4,
        "name": "powerOffCapability",
        "tag": "0009",
        "type": "nest",
        "label": "电源下电能力",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "@pmuNumber",
            "type": "int",
            "label": "上报下电能力PMU的个数",
            "unit": "个",
            "desc": "0~32"
          },
          {
            "offset": 32,
            "name": "powerOffInfo",
            "lengthKey": "powerOffCapability.@pmuNumber",
            "type": "array",
            "label": "下电能力详细信息",
            "children": [
              {
                "offset": 8,
                "name": "cabinet",
                "type": "long",
                "label": "电源/配电柜号"
              },
              {
                "offset": 8,
                "name": "subrack",
                "type": "long",
                "label": "电源/配电框号"
              },
              {
                "offset": 8,
                "name": "slot",
                "type": "long",
                "label": "电源/配电槽号"
              },
              {
                "offset": 4,
                "name": "capabilityMask",
                "type": "int",
                "label": "下电能力掩码",
                "desc": "Bit0: 槽位级下电能力(slot power-off capability)；Bit1: 端口级下电能力(port power-off capability)。mask bit为1表示对应的value bit有效"
              },
              {
                "offset": 4,
                "name": "capabilityValue",
                "type": "int",
                "label": "下电能力值",
                "desc": "Bit0: 表示不支持；Bit1: 表示支持"
              }
            ]
          }
        ]
      },
      {
        "offset": 4,
        "name": "powerSupplyTopology",
        "tag": "000a",
        "type": "nest",
        "label": "供电拓扑信息",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "@pmuNumber",
            "type": "int",
            "label": "上报供电拓扑iSDU的个数",
            "unit": "个",
            "desc": "0~4"
          },
          {
            "offset": 84,
            "name": "powerSupplyInfo",
            "lengthKey": "powerSupplyTopology.@pmuNumber",
            "type": "array",
            "label": "供电拓扑详细信息",
            "children": [
              {
                "offset": 8,
                "name": "cabinet",
                "type": "long",
                "label": "电源/配电柜号"
              },
              {
                "offset": 8,
                "name": "subrack",
                "type": "long",
                "label": "电源/配电框号"
              },
              {
                "offset": 8,
                "name": "slot",
                "type": "long",
                "label": "电源/配电槽号"
              },
              {
                "offset": 4,
                "name": "@portNumber",
                "type": "int",
                "label": "端口号个数",
                "desc": "0~6"
              },
              {
                "offset": 56,
                "name": "portInfo",
                "lengthKey": "powerSupplyTopology.powerSupplyInfo.@portNumber",
                "type": "array",
                "label": "端口信息",
                "children": [
                  {
                    "offset": 8,
                    "name": "port",
                    "type": "long",
                    "label": "电源/配电端口号"
                  },
                  {
                    "offset": 48,
                    "name": "esn",
                    "type": "ascii",
                    "label": "负载ESN号",
                    "desc": "24字节"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "offset": 4,
        "name": "pmuDetails",
        "tag": "000b",
        "type": "nest",
        "label": "PMU详细信息",
        "childrenLengthOffset": 4,
        "supportArray": true,
        "children": [
          {
            "offset": 8,
            "name": "pmuCabinet",
            "type": "int",
            "label": "PMU柜号"
          },
          {
            "offset": 8,
            "name": "pmuSubrack",
            "type": "int",
            "label": "PMU框号"
          },
          {
            "offset": 8,
            "name": "pmuSlot",
            "type": "int",
            "label": "PMU槽号"
          },
          {
            "offset": 8,
            "name": "pType",
            "type": "int",
            "label": "PMU电源系统类型",
            "enum": {
              "0": "APM100",
              "1": "APM200",
              "2": "APM30",
              "3": "EPS4890",
              "4": "EPS4815",
              "5": "SC48200",
              "7": "EPS48200",
              "8": "TP48300A",
              "10": "ETP",
              "11": "EPU",
              "12": "DCDU",
              "13": "ISDU",
              "14": "SMU"
            }
          },
          {
            "offset": 8,
            "name": "pmuTotalPower",
            "type": "int",
            "label": "PMU直流输出总功率",
            "unit": "W",
            "invalidValue": 4294967295,
            "desc": "0xFFFFFFFF表示无效值。柜号是7时，该值会覆盖tag1的xmuPmuTotalPower"
          },
          {
            "offset": 8,
            "name": "pmuMainsstatus",
            "type": "int",
            "label": "市电状态",
            "enum": {
              "0": "正常",
              "1": "市电无"
            },
            "desc": "柜号是7时，该值会覆盖tag1的mainsstatus"
          }
        ]
      },
      {
        "offset": 4,
        "name": "pmuPowerInfo",
        "tag": "000c",
        "type": "nest",
        "label": "PMU分类统计信息",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "name": "powerNum",
            "type": "int",
            "label": "PMU中电源模块的个数",
            "desc": "基站正常开工的PMU中电源模块的个数，包含正常开工的7框的PMU个数"
          }
        ]
      }
    ]
  },
  {
    "code": "0b1a",
    "name": "节能等级设置响应（0B1A）",
    "sample": "0b1a000000000000",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x0B1A"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他值表示失败"
      }
    ]
  },
  {
    "code": "2d5e",
    "name": "协同诊断开关响应（2D5E）",
    "sample": "2d5e000000",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x2D5E"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 2,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他为失败。协同诊断开关响应（前传告警增强开关）"
      }
    ]
  },
  {
    "code": "2d60",
    "name": "拓扑订阅开响应（2D60）",
    "sample": "2d6000000000000000000001",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x2D60"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他为失败。拓扑订阅开响应（订阅前传TOPO）"
      },
      {
        "offset": 8,
        "name": "TaskId",
        "type": "long",
        "label": "任务ID",
        "desc": "网元分配的订阅任务ID。成功后会被持久化，用于后续取消订阅"
      }
    ]
  },
  {
    "code": "2d62",
    "name": "拓扑订阅关响应（2D62）",
    "sample": "2d6200000000000000000001",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x2D62"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "ReturnCode",
        "type": "long",
        "label": "返回码",
        "enum": {
          "0": "成功"
        },
        "desc": "0表示成功，其他为失败。拓扑订阅关响应（去订阅前传TOPO）"
      },
      {
        "offset": 8,
        "name": "TaskID",
        "type": "long",
        "label": "任务ID",
        "desc": "被取消的订阅任务ID"
      }
    ]
  },
  {
    "code": "2d63",
    "name": "拓扑数据上报（2D63）",
    "sample": "2d630000000000010001000100000020000100140000000100000002000000030000000400000005000200040000000100000066000100240000000100000002000000030000000400000005000000060000000700000008000000090002002400000001000000020000000300000004000000050000000600000007000000080000000900030012000100010003000200010003000400010064",
    "fields": [
      {
        "offset": 4,
        "type": "hex",
        "name": "cmdCode",
        "label": "命令码",
        "desc": "0x2D63"
      },
      {
        "offset": 4,
        "type": "hex",
        "name": "Handle",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "type": "long",
        "name": "TaskID",
        "label": "任务ID",
        "desc": "该拓扑上报所属的订阅任务ID（与2D60返回的TaskId对应）"
      },
      {
        "offset": 4,
        "type": "int",
        "name": "NodeInfoNumber",
        "label": "节点信息个数",
        "desc": "后续NodeInfo的个数"
      },
      {
        "offset": 4,
        "type": "int",
        "name": "LineInfoNumber",
        "label": "链路信息个数",
        "desc": "后续LineInfo的个数"
      },
      {
        "offset": 4,
        "type": "nest",
        "tag": "0000",
        "name": "NodeInfo",
        "label": "节点信息",
        "desc": "拓扑节点，表示一个支持OTDR的板/端口位置",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "type": "nest",
            "tag": "0001",
            "name": "NodeId",
            "label": "节点标识",
            "desc": "节点的物理位置信息",
            "childrenLengthOffset": 4,
            "children": [
              {
                "offset": 8,
                "type": "long",
                "name": "PhyPosID",
                "label": "物理位置ID"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "CabinetNo",
                "label": "柜号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SubrackNo",
                "label": "框号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SlotNo",
                "label": "槽号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "MuxID",
                "label": "复用ID"
              }
            ]
          },
          {
            "type": "nest",
            "offset": 4,
            "tag": "0002",
            "name": "AttrInfo",
            "label": "节点属性",
            "childrenLengthOffset": 4,
            "children": [
              {
                "offset": 8,
                "type": "long",
                "name": "NodeType",
                "label": "节点类型"
              }
            ]
          }
        ]
      },
      {
        "type": "nest",
        "offset": 4,
        "name": "LineInfo",
        "label": "链路信息",
        "desc": "两个节点之间的光路链路，包含波长和逐段跳数/长度信息",
        "childrenLengthOffset": 4,
        "children": [
          {
            "offset": 4,
            "type": "nest",
            "name": "NodeID1",
            "label": "端点1",
            "desc": "链路端点1的物理位置和波长信息",
            "tag": "0001",
            "childrenLengthOffset": 4,
            "children": [
              {
                "offset": 8,
                "type": "long",
                "name": "NodePhyPosID1",
                "label": "物理位置ID"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "CabinetNo1",
                "label": "柜号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SubrackNo1",
                "label": "框号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SlotNo1",
                "label": "槽号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "MuxID1",
                "label": "复用ID"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "PortNo1",
                "label": "端口号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SubPortNo1",
                "label": "子端口号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "TxWaveLength1",
                "label": "发送波长"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "RxWaveLength1",
                "label": "接收波长"
              }
            ]
          },
          {
            "offset": 4,
            "type": "nest",
            "tag": "0002",
            "name": "NodeID2",
            "label": "端点2",
            "desc": "链路端点2的物理位置和波长信息",
            "childrenLengthOffset": 4,
            "children": [
              {
                "offset": 8,
                "type": "long",
                "name": "NodePhyPosID2",
                "label": "物理位置ID"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "CabinetNo2",
                "label": "柜号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SubrackNo2",
                "label": "框号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SlotNo2",
                "label": "槽号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "MuxID2",
                "label": "复用ID"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "PortNo2",
                "label": "端口号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "SubPortNo2",
                "label": "子端口号"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "TxWaveLength2",
                "label": "发送波长"
              },
              {
                "offset": 8,
                "type": "long",
                "name": "RxWaveLength2",
                "label": "接收波长"
              }
            ]
          },
          {
            "type": "nest",
            "offset": 4,
            "name": "AttrInfo",
            "label": "链路属性",
            "childrenLengthOffset": 4,
            "tag": "0003",
            "children": [
              {
                "type": "int",
                "offset": 4,
                "name": "otdrType",
                "label": "OTDR类型",
                "desc": "该链路的OTDR测量类型"
              },
              {
                "type": "int",
                "offset": 4,
                "name": "@LineNumber",
                "label": "线段个数",
                "desc": "后续HopCountAndLengthArray的元素个数"
              },
              {
                "type": "nest",
                "offset": 4,
                "name": "lineJumpNumberInfo",
                "label": "跳纤信息",
                "childrenLengthOffset": 4,
                "tag": "0003",
                "children": [
                  {
                    "offset": 4,
                    "name": "TotalLineJumpNumber",
                    "type": "int",
                    "label": "跳纤总数",
                    "desc": "该链路上的光纤跳接/熔接点总数"
                  }
                ]
              },
              {
                "type": "array",
                "offset": 4,
                "name": "HopCountAndLengthArray",
                "label": "跳数与长度数组",
                "childrenLengthOffset": 4,
                "lengthKey": "LineInfo.AttrInfo.@LineNumber",
                "tag": "0003",
                "children": [
                  {
                    "type": "nest",
                    "offset": 4,
                    "name": "HopCountAndLengthInfo",
                    "label": "跳数与长度信息",
                    "childrenLengthOffset": 4,
                    "tag": "0003",
                    "children": [
                      {
                        "offset": 4,
                        "name": "HopCount",
                        "type": "int",
                        "label": "跳数"
                      },
                      {
                        "offset": 4,
                        "name": "LineLength",
                        "type": "int",
                        "label": "线段长度"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  {
    "code": "2d94",
    "name": "时钟同步状态（2D94）",
    "sample": "2d94000000000001010101000000020000000300000004",
    "fields": [
      {
        "offset": 4,
        "name": "cmdCode",
        "type": "hex",
        "label": "命令码",
        "desc": "0x2D94"
      },
      {
        "offset": 4,
        "name": "Handle",
        "type": "hex",
        "label": "句柄号",
        "desc": "例如 0xFFFF"
      },
      {
        "offset": 8,
        "name": "time",
        "type": "long",
        "label": "时间",
        "desc": "UTC时间，单位：秒"
      },
      {
        "offset": 2,
        "name": "clkSrcType",
        "type": "long",
        "label": "时钟源类型",
        "desc": "bitmap。BIT0=GNSS，BIT1=IPCLK，BIT2=SYNCETH，BIT3=TOD，BIT4=PEERCLK"
      },
      {
        "offset": 2,
        "name": "clkLockedType",
        "type": "long",
        "label": "时钟锁定类型",
        "enum": {
          "0": "其它",
          "1": "GNSS",
          "2": "IPCLK",
          "3": "TOD",
          "4": "PEERCLK",
          "5": "IPCLK+SYNCETH"
        }
      },
      {
        "offset": 2,
        "name": "syncStatus",
        "type": "long",
        "label": "时钟同步状态",
        "enum": {
          "0": "自振",
          "1": "快捕",
          "2": "锁定",
          "3": "保持"
        }
      },
      {
        "offset": 8,
        "name": "holdTime",
        "type": "long",
        "label": "保持时间",
        "unit": "分钟",
        "invalidValue": 0,
        "desc": "0表示无效值"
      },
      {
        "offset": 8,
        "name": "Resv1",
        "type": "long",
        "label": "保留字段1",
        "desc": "保留字段，无业务含义"
      },
      {
        "offset": 8,
        "name": "Resv2",
        "type": "long",
        "label": "保留字段2",
        "desc": "保留字段，无业务含义"
      }
    ]
  }
];
