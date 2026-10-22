#!/usr/bin/env python3
"""
PR 分析器：分析变更复杂度，并建议检视方式。

用法：
    python pr-analyzer.py [--diff-file FILE] [--stats]

    也可直接通过管道传入差异：
    git diff main...HEAD | python pr-analyzer.py
"""

import os
import sys
import re
import argparse
from collections import defaultdict
from dataclasses import dataclass
from typing import List, Dict, Optional

RISK_NO_TESTS = "NO_TEST_CHANGES"


@dataclass
class FileStats:
    """单个文件的统计信息。"""
    filename: str
    additions: int = 0
    deletions: int = 0
    is_test: bool = False
    is_config: bool = False
    language: str = "unknown"


@dataclass
class PRAnalysis:
    """完整的 PR 分析结果。"""
    total_files: int
    total_additions: int
    total_deletions: int
    files: List[FileStats]
    complexity_score: float
    size_category: str
    estimated_review_time: int
    risk_factors: List[str]
    suggestions: List[str]


def detect_language(filename: str) -> str:
    """根据文件名识别编程语言。"""
    _, ext = os.path.splitext(filename)
    extensions = {
        '.py': 'Python',
        '.js': 'JavaScript',
        '.ts': 'TypeScript',
        '.tsx': 'TypeScript/React',
        '.jsx': 'JavaScript/React',
        '.rs': 'Rust',
        '.go': 'Go',
        '.c': 'C',
        '.h': 'C/C++',
        '.cpp': 'C++',
        '.hpp': 'C++',
        '.cc': 'C++',
        '.cxx': 'C++',
        '.hh': 'C++',
        '.hxx': 'C++',
        '.java': 'Java',
        '.kt': 'Kotlin',
        '.swift': 'Swift',
        '.rb': 'Ruby',
        '.php': 'PHP',
        '.cs': 'C#',
        '.vue': 'Vue',
        '.svelte': 'Svelte',
        '.sql': 'SQL',
        '.md': 'Markdown',
        '.json': 'JSON',
        '.yaml': 'YAML',
        '.yml': 'YAML',
        '.toml': 'TOML',
        '.css': 'CSS',
        '.scss': 'SCSS',
        '.less': 'Less',
        '.html': 'HTML',
        '.zig': 'Zig',
        '.ex': 'Elixir',
        '.exs': 'Elixir',
        '.erl': 'Erlang',
        '.scala': 'Scala',
        '.lua': 'Lua',
    }
    return extensions.get(ext.lower(), 'unknown')


def is_test_file(filename: str) -> bool:
    """检查是否为测试文件。"""
    test_patterns = [
        r'(?:^|/)test_[^/]+\.py$',   # Python: test_handler.py （匹配路径段边界）
        r'[^/]+_test\.',             # *_test.<ext> — Rust、Go 等
        r'[^/]+\.test\.(js|ts|tsx|jsx)$',  # JS/TS: handler.test.ts
        r'[^/]+\.spec\.(js|ts|tsx|jsx)$',  # JS/TS: handler.spec.ts
        r'(?:^|/)tests?/',           # tests/ 或 test/ 目录
        r'(?:^|/)__tests__/',        # __tests__/ 目录
        r'(?:^|/)spec/',             # spec/ 目录（Ruby 等）
    ]
    return any(re.search(p, filename) for p in test_patterns)


def is_config_file(filename: str) -> bool:
    """检查是否为配置文件。

    通过明确的已知名称匹配，避免将数据文件
    （如 data.json、openapi.yaml、swagger.json）误判为配置。
    """
    basename = os.path.basename(filename)

    # 环境文件（.env、.env.local、.env.production 等）
    if basename.startswith('.env'):
        return True

    # 已知配置文件名（精确匹配）
    known_config_names = {
        'package.json', 'package-lock.json',
        'tsconfig.json', 'jsconfig.json',
        'babel.config.json', 'babel.config.js',
        'webpack.config.js', 'webpack.config.ts',
        'rollup.config.js', 'vite.config.ts', 'vite.config.js',
        '.eslintrc.json', '.eslintrc.js', '.eslintrc.yml',
        '.prettierrc.json', '.prettierrc.yml', '.prettierrc.js',
        'jest.config.js', 'jest.config.ts',
        'vitest.config.ts', 'vitest.config.js',
        'tailwind.config.js', 'tailwind.config.ts',
        'postcss.config.js',
        'docker-compose.yml', 'docker-compose.yaml',
        'Dockerfile',
        'Makefile', 'CMakeLists.txt',
        'pyproject.toml', 'poetry.toml', 'Pipfile',
        'setup.cfg', 'setup.py', 'tox.ini',
        'Cargo.toml', 'Cargo.lock',
        'go.mod', 'go.sum',
        'Gemfile', 'Gemfile.lock',
        'composer.json', 'composer.lock',
        'Podfile', 'Package.swift',
        '.gitignore', '.gitattributes',
        'gradle.properties', 'build.gradle', 'build.gradle.kts',
        'settings.gradle', 'settings.gradle.kts',
    }
    if basename in known_config_names:
        return True

    # 已知配置路径模式
    config_path_patterns = [
        r'\.github/workflows/[^/]+\.ya?ml$',
        r'\.vscode/',
        r'\.idea/',
    ]
    if any(re.search(p, filename) for p in config_path_patterns):
        return True

    # 名称含 config 的文件（如 app.config.ts、database_config.yml）
    if re.search(r'config\.', basename):
        return True

    # config/ 目录下的文件
    if re.search(r'(?:^|/)config/', filename):
        return True

    return False


def parse_diff(diff_content: str) -> List[FileStats]:
    """解析 git diff 输出并提取文件统计。"""
    files = []
    current_file = None

    for line in diff_content.split('\n'):
        # 新文件头
        if line.startswith('diff --git'):
            if current_file:
                files.append(current_file)
            # “diff --git a/<path> b/<path>”：通过反向引用匹配 b/ 一侧，
            # 避免将 lib/、web/ 或 db/ 等路径内部的 “b/”
            # 误认为前缀。重命名时两侧路径不同，
            # 因此回退为匹配分隔空格之后的 b/ 一侧。
            match = re.match(r'diff --git a/(.+?) b/\1', line)
            if not match:
                match = re.search(r' b/(.+)$', line)
            if match:
                filename = match.group(1)
                current_file = FileStats(
                    filename=filename,
                    language=detect_language(filename),
                    is_test=is_test_file(filename),
                    is_config=is_config_file(filename),
                )
            else:
                current_file = None
        elif current_file:
            if line.startswith('+') and not line.startswith('+++'):
                current_file.additions += 1
            elif line.startswith('-') and not line.startswith('---'):
                current_file.deletions += 1

    if current_file:
        files.append(current_file)

    return files


def calculate_complexity(files: List[FileStats]) -> float:
    """计算复杂度分数，范围为 0～1。"""
    if not files:
        return 0.0

    total_changes = sum(f.additions + f.deletions for f in files)

    # 基于变更规模的复杂度
    size_factor = min(total_changes / 1000, 1.0)

    # 文件数量因子
    file_factor = min(len(files) / 20, 1.0)

    # 非测试代码占比因子
    test_lines = sum(f.additions + f.deletions for f in files if f.is_test)
    non_test_ratio = 1 - (test_lines / max(total_changes, 1))

    # 语言多样性因子
    languages = set(f.language for f in files if f.language != 'unknown')
    lang_factor = min(len(languages) / 5, 1.0)

    complexity = (
        size_factor * 0.4 +
        file_factor * 0.2 +
        non_test_ratio * 0.2 +
        lang_factor * 0.2
    )

    return round(complexity, 2)


def categorize_size(total_changes: int) -> str:
    """划分 PR 规模。"""
    if total_changes < 50:
        return "XS（极小）"
    elif total_changes < 200:
        return "S（小）"
    elif total_changes < 400:
        return "M（中）"
    elif total_changes < 800:
        return "L（大）"
    else:
        return "XL（极大）— 建议拆分"


def estimate_review_time(files: List[FileStats], complexity: float) -> int:
    """估算检视时间，单位为分钟。"""
    total_changes = sum(f.additions + f.deletions for f in files)

    # 基础时间：每 20 行约 1 分钟
    base_time = total_changes / 20

    # 根据复杂度调整
    adjusted_time = base_time * (1 + complexity)

    # 最少 5 分钟，最多 120 分钟
    return max(5, min(120, int(adjusted_time)))


def identify_risk_factors(files: List[FileStats]) -> List[str]:
    """识别 PR 中的潜在风险因素。"""
    risks = []

    total_changes = sum(f.additions + f.deletions for f in files)
    test_changes = sum(f.additions + f.deletions for f in files if f.is_test)

    if total_changes > 400:
        risks.append("大型 PR（超过 400 行）— 较难全面检视")

    if test_changes == 0 and total_changes > 50:
        risks.append(f"{RISK_NO_TESTS}: 没有测试变更，请确认测试覆盖")

    if total_changes > 100 and test_changes / max(total_changes, 1) < 0.2:
        risks.append("测试变更占比低于 20%，建议补充测试")

    # 安全敏感文件
    security_patterns = ['.env', 'auth', 'security', 'password', 'token', 'secret']
    for f in files:
        if any(p in f.filename.lower() for p in security_patterns):
            risks.append(f"安全敏感文件： {f.filename}")
            break

    # 数据库变更
    for f in files:
        if 'migration' in f.filename.lower() or f.language == 'SQL':
            risks.append("检测到数据库变更，请重点检视")
            break

    # 配置变更
    config_files = [f for f in files if f.is_config]
    if config_files:
        risks.append(f"配置变更涉及 {len(config_files)} 个文件")

    return risks


def generate_suggestions(files: List[FileStats], complexity: float, risks: List[str]) -> List[str]:
    """生成检视建议。"""
    suggestions = []

    total_changes = sum(f.additions + f.deletions for f in files)

    if total_changes > 800:
        suggestions.append("建议将此 PR 拆分为更小、职责更集中的变更")

    if complexity > 0.7:
        suggestions.append("复杂度较高，建议预留更多检视时间")
        suggestions.append("关键部分可考虑结对检视")

    if any(RISK_NO_TESTS in r for r in risks):
        suggestions.append("通过前要求补充测试")

    # 针对具体语言的建议
    languages = set(f.language for f in files)
    if 'TypeScript' in languages or 'TypeScript/React' in languages:
        suggestions.append("检查类型使用是否合理，避免 'any'")
    if 'Rust' in languages:
        suggestions.append("检查 unwrap() 的使用与错误处理")
    if 'C' in languages or 'C++' in languages or 'C/C++' in languages:
        suggestions.append("检查内存安全、边界检查与未定义行为风险")
    if 'SQL' in languages:
        suggestions.append("检查 SQL 注入与查询性能")

    if not suggestions:
        suggestions.append("按标准检视流程处理即可")

    return suggestions


def analyze_pr(diff_content: str) -> PRAnalysis:
    """执行完整 PR 分析。"""
    files = parse_diff(diff_content)

    total_additions = sum(f.additions for f in files)
    total_deletions = sum(f.deletions for f in files)
    total_changes = total_additions + total_deletions

    complexity = calculate_complexity(files)
    risks = identify_risk_factors(files)
    suggestions = generate_suggestions(files, complexity, risks)

    return PRAnalysis(
        total_files=len(files),
        total_additions=total_additions,
        total_deletions=total_deletions,
        files=files,
        complexity_score=complexity,
        size_category=categorize_size(total_changes),
        estimated_review_time=estimate_review_time(files, complexity),
        risk_factors=risks,
        suggestions=suggestions,
    )


def print_analysis(analysis: PRAnalysis, show_files: bool = False):
    """打印分析结果。"""
    print("\n" + "=" * 60)
    print("PR 分析报告")
    print("=" * 60)

    print(f"\n📊 概要")
    print(f"   变更文件数： {analysis.total_files}")
    print(f"   新增行数： +{analysis.total_additions}")
    print(f"   删除行数： -{analysis.total_deletions}")
    print(f"   总变更行数： {analysis.total_additions + analysis.total_deletions}")

    print(f"\n📏 规模： {analysis.size_category}")
    print(f"   复杂度分数： {analysis.complexity_score}/1.0")
    print(f"   预计检视时间： ~{analysis.estimated_review_time} 分钟")

    if analysis.risk_factors:
        print(f"\n⚠️  风险因素：")
        for risk in analysis.risk_factors:
            print(f"   • {risk}")

    print(f"\n💡 建议：")
    for suggestion in analysis.suggestions:
        print(f"   • {suggestion}")

    if show_files:
        print(f"\n📁 文件：")
        # 按语言分组
        by_lang: Dict[str, List[FileStats]] = defaultdict(list)
        for f in analysis.files:
            by_lang[f.language].append(f)

        for lang, lang_files in sorted(by_lang.items()):
            print(f"\n   [{lang}]")
            for f in lang_files:
                prefix = "🧪" if f.is_test else "⚙️" if f.is_config else "📄"
                print(f"   {prefix} {f.filename} (+{f.additions}/-{f.deletions})")

    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description='分析 PR 复杂度')
    parser.add_argument('--diff-file', '-f', help='差异文件路径')
    parser.add_argument('--stats', '-s', action='store_true', help='显示文件详情')
    args = parser.parse_args()

    # 从文件或标准输入读取差异
    try:
        if args.diff_file:
            with open(args.diff_file, 'r', encoding='utf-8', errors='replace') as f:
                diff_content = f.read()
        elif not sys.stdin.isatty():
            diff_content = sys.stdin.buffer.read().decode('utf-8', errors='replace')
        else:
            print("用法： git diff main...HEAD | python pr-analyzer.py")
            print("       python pr-analyzer.py -f diff.txt")
            sys.exit(1)
    except OSError as e:
        print(f"读取差异输入失败： {e}", file=sys.stderr)
        sys.exit(1)

    if not diff_content.strip():
        print("未提供差异内容")
        sys.exit(1)

    analysis = analyze_pr(diff_content)
    print_analysis(analysis, show_files=args.stats)


if __name__ == '__main__':
    main()
