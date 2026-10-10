"""Generic orchestration; all product code and checks come from the runtime model."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import yaml
from arcbench_agent_runtime import AgentRuntime
from deepseek_harness import DeepSeekHarness

GUIDANCE = """Implement the assigned requirements in the platform-provided application.
Read .evolution/verification-skill.md and use its workflow to derive your own tests
from the platform materials during this run.
Read the assigned specification and record requirement-derived actions and expected
outcomes in .evolution/coverage.md BEFORE inspecting implementation or earlier tests.
Then inspect the existing implementation and direct callers. Preserve existing
functionality, data, architecture and dependencies.
The platform requirement document and reference files are the source of truth.
Derive implementation decisions, required initial records, edge cases and tests
from those materials during this run. Implement actual behavior for arbitrary
valid inputs, not just the illustrated examples. Do not access private tests,
evaluator internals, external model services or previously completed applications.

Inventory every existing test suite before changing it. Preserve all existing tests
and run them as a regression gate; add focused checks beside them instead of
replacing the inherited suite. Write and run focused checks for the assigned requirements using existing project
test tools. Exercise actual UI actions, rejected operations, persistence and
permissions where required. Test on a disposable copy of the application's data;
do not modify the original database to manufacture a passing result. Any required
new schemas/data must be implemented through idempotent application initialization
that preserves user edits. Keep test fixtures separate from implementation logic.
Reuse existing dependencies and helpers. Keep package manifests and lockfiles in
sync. Build the frontend and ensure the backend serves it using the supplied PORT.
Keep concise progress and test commands in .evolution/notes.md for later sessions.
Avoid unrelated rewrites and repeat tests only when a change or failure warrants it.
All product edits and any newly authored tests must be made during this model run.
"""

def render(node):
    text = [f"## {node['id']} {node['name']}", node.get('description', '')]
    if node.get('dependencies'):
        text.append('Dependencies: ' + ', '.join(node['dependencies']))
    for scenario in node.get('scenarios', []):
        text.append('Scenario: ' + scenario['name'])
        text.extend(f"{s['keyword']} {s['content']}" for s in scenario['steps'])
    text.extend(render(child) for child in node.get('children', []))
    return '\n\n'.join(text)


def initialize_output(output, bundle):
    # No baseline or product code is distributed in this agent's ZIP.
    required = ('frontend/package.json', 'backend/package.json')
    if all((output / name).is_file() for name in required):
        return 'prepopulated-output'
    if any(output.iterdir()) if output.is_dir() else False:
        raise RuntimeError('Incomplete populated output; refusing to overwrite it')
    supplied = os.environ.get('ARCBENCH_TEMPLATE_DIR')
    template = Path(supplied).resolve() if supplied else bundle / 'template'
    if not all((template / name).is_file() for name in required):
        raise RuntimeError('Platform application is missing; no private seed fallback')
    shutil.copytree(template, output, dirs_exist_ok=True)
    return 'platform-template'


def run_turn(harness, prompt, session_id):
    for attempt in range(3):
        error_code = None
        error_status = None
        quota_exhausted = False

        def observe(notification):
            nonlocal error_code, error_status, quota_exhausted
            if notification.method != 'session.event':
                return
            event = notification.payload.get('event', {})
            if event.get('type') in {'turn/start', 'turn/end'}:
                print('[evolution] event=' + event['type'], flush=True)
            if event.get('type') == 'turn/end':
                reason = event.get('data', {}).get('reason') or {}
                if reason.get('kind') == 'error':
                    error = reason.get('error') or {}
                    error_code = error.get('code') if isinstance(error, dict) else None
                    detail = json.dumps(error, ensure_ascii=True).lower()
                    quota_exhausted = any(marker in detail for marker in (
                        'insufficient_quota', 'balance too low', 'free allocated quota exceeded', 'quota exhausted'))
                    allowed = {'AUTH', 'QUOTA', 'RATE_LIMIT', 'TIMEOUT', 'NETWORK',
                               'SERVER', 'API', 'INVALID_REQUEST', 'CONTEXT_LENGTH',
                               'CONTEXT_WINDOW_EXCEEDED', 'EMPTY_RESPONSE', 'STREAM_CLOSED'}
                    code = error_code if error_code in allowed else 'OTHER'
                    status = error.get('status') if isinstance(error, dict) else None
                    if type(status) is not int or not 100 <= status <= 599:
                        status = None
                    error_status = status
                    print(f'[evolution] model_error={code} http_status={status}', flush=True)

        suffix = '' if attempt == 0 else f'-retry-{attempt}'
        result = harness.run(prompt, session_id=session_id + suffix,
                             on_notification=observe)
        if result.finish_reason == 'completed':
            return result
        if quota_exhausted or error_code == 'AUTH' or error_status == 402 or (error_code == 'QUOTA' and error_status != 429):
            raise RuntimeError(f'Model billing/authentication error: {error_code}')
        if result.finish_reason != 'error' or attempt == 2:
            raise RuntimeError(f'Model did not complete {session_id}')
        print(f'[evolution] retry={attempt + 1}/2 session={session_id}', flush=True)
        time.sleep((60 if error_status == 429 else 10) * (attempt + 1))
        prompt += ('\nThe previous session terminated. Preserve all completed edits; '
                   'inspect current files and notes, then finish only remaining work.')
    raise AssertionError('unreachable')


def prepare_specs(requirement_file, output):
    tree = yaml.safe_load(requirement_file.read_text())
    root = render({k: v for k, v in tree.items() if k != 'children'})
    children = tree.get('children') or []
    target = output / '.evolution'
    target.mkdir(exist_ok=True)
    shutil.copyfile(requirement_file, target / 'requirements.yaml')
    # Same batching rule for every task; only platform requirements supply content.
    groups = [children[i:i + 2] for i in range(0, len(children), 2)] or [[]]
    parts = []
    for index, group in enumerate(groups, 1):
        path = target / f'module-{index}.md'
        path.write_text(root + '\n\n' + '\n\n'.join(map(render, group)))
        parts.append(path)
    return parts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('requirement_path', nargs='?', default=os.getenv('ARCBENCH_TASK_DIR'))
    parser.add_argument('--output-dir', default=os.getenv('ARCBENCH_OUTPUT_DIR'))
    parser.add_argument('--type', default='web')
    args = parser.parse_args()
    if not args.requirement_path or not args.output_dir:
        parser.error('requirement directory and output directory are required')
    task = Path(args.requirement_path).resolve()
    output = Path(args.output_dir).resolve()
    origin = initialize_output(output, Path(__file__).resolve().parent)
    parts = prepare_specs(task / 'requirements.yaml', output)
    shutil.copyfile(Path(__file__).parent / 'skills/verify-from-requirements/SKILL.md',
                    output / '.evolution/verification-skill.md')
    hashes = {str(f.relative_to(output)): hashlib.sha256(f.read_bytes()).hexdigest()
              for folder in ('frontend/src', 'backend/src')
              for f in sorted((output / folder).rglob('*')) if f.is_file()}
    (output / '.evolution/baseline.json').write_text(json.dumps({
        'origin': origin, 'source_hashes_before_model': hashes}, indent=2))
    if (task / 'reference').is_dir():
        shutil.copytree(task / 'reference', output / '.evolution/reference', dirs_exist_ok=True)
    runtime = AgentRuntime.from_env(project_dir=str(output))
    runtime.events.mark_run_started('Generate application and checks from platform requirements')
    runtime.git.ensure_repo()
    runtime.git.commit('Record platform baseline before model edits')
    with tempfile.TemporaryDirectory(prefix='evolution-dsh-') as home:
        backups = {}
        for relative in ('database.db', 'backend/database.db'):
            database = output / relative
            if database.is_file():
                backup = Path(home) / 'platform-data' / relative
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(database, backup)
                backups[relative] = backup
        check_env = {k: os.environ[k] for k in ('PATH', 'HOME', 'PLAYWRIGHT_BROWSERS_PATH') if k in os.environ}
        if 'backend/database.db' in backups:
            check_env['ARC_CHECK_INITIAL_DB'] = str(backups['backend/database.db'])
        try:
            with DeepSeekHarness(
                provider='deepseek-official', model=os.environ.get('MODEL', 'deepseek-v4-flash-vision-exp'),
                reasoning_effort='low', max_tokens=32768, profile='sdk-minimal',
                cwd=str(output), dsh_home=home, base_url=os.environ['OPENAI_BASE_URL'],
                api_key=os.environ['OPENAI_API_KEY'], request_timeout_seconds=2400,
            ) as harness:
                for index, part in enumerate(parts, 1):
                    print('[evolution] implementing ' + part.name, flush=True)
                    result = run_turn(harness, GUIDANCE + '\nAssigned scope:\n' + str(part),
                                      'module-' + str(index))
                    part.with_suffix('.report.txt').write_text(result.final_response)
                    runtime.git.commit('Implement requirements batch ' + str(index))
                final_prompt = GUIDANCE + '''
All batches have been implemented. In this fresh session, first read the complete
platform requirements and derive an independent checklist in
.evolution/independent-review.md BEFORE reading implementation reports or tests.
Then inspect the code and actual rendered interface, compare your checklist with
the existing coverage, and add only missing checks justified by the requirements.
Keep every inherited test suite in the final runner; do not replace it with only
the new feature checks.
Review interaction semantics and each documented transition, not just visible text
or a test suite's pass count. Audit generated assertions for false confidence using
the skill; verify the runner propagates a deliberately failing isolated check,
restore it, and report actual executed counts and coverage gaps. Reuse checks
written during this run and any tests
provided with the platform application. Create .evolution/self-check.sh as a
repeatable runner for those checks, including browser checks of required workflows.
The harness will run it using bash from the application root without model keys.
If ARC_CHECK_INITIAL_DB is supplied, use a disposable copy of that database for
testing. Otherwise use disposable data. Clean up temporary servers on exit.
The runner must return a nonzero exit code for a failed check, and print a concise
summary. Do not manufacture test results or skip failing requirements. Execute the
runner, fix defects and build the frontend. Limit yourself to two repair cycles.
Report per-suite discovered/executed/passed/failed/skipped counts and unresolved
coverage gaps. No prewritten external test scripts
are supplied; derive all new checks from the platform requirements in this run.
'''
                result = run_turn(harness, final_prompt, 'final-verification')
                (output / '.evolution/verification.report.txt').write_text(result.final_response)
                script = output / '.evolution/self-check.sh'
                for attempt in range(2):
                    if not script.is_file():
                        evidence, failed = 'The model-generated .evolution/self-check.sh is missing.', True
                    else:
                        try:
                            checked = subprocess.run(['bash', str(script)], cwd=output,
                                env=check_env, capture_output=True, text=True, timeout=900)
                            evidence = checked.stdout + checked.stderr
                            failed = checked.returncode != 0
                        except subprocess.TimeoutExpired:
                            evidence, failed = 'Model-generated self-check runner exceeded 900 seconds.', True
                    (output / f'.evolution/self-check-{attempt}.txt').write_text(evidence)
                    print(f'[evolution] self_check_attempt={attempt} passed={not failed}', flush=True)
                    if not failed:
                        break
                    if attempt == 0:
                        run_turn(harness, GUIDANCE + '\nYour generated check runner failed. Fix the '
                                 'implementation or runner infrastructure without weakening required '
                                 'assertions. Rebuild and rerun. Evidence:\n' + evidence[-14000:],
                                 'verification-repair')
                built = subprocess.run(['npm', 'run', 'build'], cwd=output / 'frontend',
                    capture_output=True, text=True, timeout=180)
                if built.returncode:
                    run_turn(harness, GUIDANCE + '\nFix the build failure:\n' +
                             (built.stdout + built.stderr)[-6000:], 'build-repair')
                    subprocess.run(['npm', 'run', 'build'], cwd=output / 'frontend', check=True, timeout=180)
        finally:
            for relative, backup in backups.items():
                shutil.copyfile(backup, output / relative)
            (output / '.evolution/restored-databases.json').write_text(json.dumps({
                relative: hashlib.sha256((output / relative).read_bytes()).hexdigest()
                for relative in backups}, indent=2))
    runtime.git.commit('Verify application with runtime-model-generated checks')
    runtime.events.mark_run_completed('Model generation completed; official evaluation pending')


if __name__ == '__main__':
    main()


