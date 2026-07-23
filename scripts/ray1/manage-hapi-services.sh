#!/usr/bin/env bash
set -euo pipefail

HAPI_HUB_SESSION="hapi-ray1"
HAPI_RUNNER_SESSION="hapi-runner-ray1"
HAPI_HEALTH_URL="${HAPI_HEALTH_URL:-http://127.0.0.1:3006/health}"

process_is_running() {
    local process_id="$1"
    local process_state

    if ! kill -0 "${process_id}" 2>/dev/null; then
        return 1
    fi
    process_state="$(ps -o stat= -p "${process_id}" 2>/dev/null | tr -d '[:space:]')"
    [ -n "${process_state}" ] && [[ "${process_state}" != Z* ]]
}

stop_tmux_session() {
    local session_name="$1"
    if ! tmux has-session -t "${session_name}" 2>/dev/null; then
        return
    fi

    tmux send-keys -t "${session_name}" C-c
    for _ in $(seq 1 20); do
        if ! tmux has-session -t "${session_name}" 2>/dev/null; then
            return
        fi
        sleep 0.25
    done
    tmux kill-session -t "${session_name}"
}

stop_legacy_processes() {
    local process_kind="$1"
    local process_pattern

    case "${process_kind}" in
        hub)
            process_pattern='[h]api hub --relay'
            ;;
        runner)
            process_pattern='[h]api runner start-sync'
            ;;
        *)
            return 1
            ;;
    esac

    mapfile -t process_ids < <(pgrep -f "${process_pattern}" || true)
    if [ "${#process_ids[@]}" -gt 0 ]; then
        kill -TERM "${process_ids[@]}"
        for _ in $(seq 1 20); do
            local any_alive="false"
            for process_id in "${process_ids[@]}"; do
                if process_is_running "${process_id}"; then
                    any_alive="true"
                    break
                fi
            done
            if [ "${any_alive}" = "false" ]; then
                return
            fi
            sleep 0.25
        done

        local remaining_ids=()
        for process_id in "${process_ids[@]}"; do
            if process_is_running "${process_id}"; then
                remaining_ids+=("${process_id}")
            fi
        done
        if [ "${#remaining_ids[@]}" -gt 0 ]; then
            kill -KILL "${remaining_ids[@]}"
        fi
    fi
}

start_hub() {
    if tmux has-session -t "${HAPI_HUB_SESSION}" 2>/dev/null; then
        printf 'Hub tmux session already exists: %s\n' "${HAPI_HUB_SESSION}"
        return
    fi
    tmux new-session -d -s "${HAPI_HUB_SESSION}" /root/bin/hapi-hub-service

    for _ in $(seq 1 60); do
        if curl --fail --silent "${HAPI_HEALTH_URL}" >/dev/null; then
            printf 'Hub is healthy.\n'
            return
        fi
        sleep 0.5
    done

    tmux capture-pane -p -t "${HAPI_HUB_SESSION}" -S -120 || true
    printf 'Hub did not become healthy at %s\n' "${HAPI_HEALTH_URL}" >&2
    exit 1
}

start_runner() {
    if tmux has-session -t "${HAPI_RUNNER_SESSION}" 2>/dev/null; then
        printf 'Runner tmux session already exists: %s\n' "${HAPI_RUNNER_SESSION}"
        return
    fi
    tmux new-session -d -s "${HAPI_RUNNER_SESSION}" /root/bin/hapi-runner-service

    for _ in $(seq 1 60); do
        if pgrep -f '[h]api runner start-sync' >/dev/null; then
            printf 'Runner is running.\n'
            return
        fi
        if ! tmux has-session -t "${HAPI_RUNNER_SESSION}" 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    tmux capture-pane -p -t "${HAPI_RUNNER_SESSION}" -S -120 2>/dev/null || true
    printf 'Runner did not start successfully.\n' >&2
    exit 1
}

show_status() {
    printf 'Binary: '
    /root/.local/bin/hapi --version

    printf 'Hub tmux: '
    if tmux has-session -t "${HAPI_HUB_SESSION}" 2>/dev/null; then
        printf 'running\n'
    else
        printf 'stopped\n'
    fi

    printf 'Runner tmux: '
    if tmux has-session -t "${HAPI_RUNNER_SESSION}" 2>/dev/null; then
        printf 'running\n'
    else
        printf 'stopped\n'
    fi

    printf 'Runner process: '
    if pgrep -f '[h]api runner start-sync' >/dev/null; then
        printf 'running\n'
    else
        printf 'stopped\n'
    fi

    printf 'Health: '
    if curl --fail --silent "${HAPI_HEALTH_URL}"; then
        printf '\n'
    else
        printf 'unavailable\n'
    fi

    if tmux has-session -t "${HAPI_HUB_SESSION}" 2>/dev/null; then
        printf 'Relay: '
        tmux capture-pane -p -t "${HAPI_HUB_SESSION}" -S -240 \
            | grep -Eo 'https://[a-z0-9]+\.relay\.hapi\.run' \
            | tail -n 1 \
            || true
    fi
}

case "${1:-status}" in
    start)
        start_hub
        start_runner
        show_status
        ;;
    stop)
        stop_tmux_session "${HAPI_RUNNER_SESSION}"
        stop_legacy_processes runner
        stop_tmux_session "${HAPI_HUB_SESSION}"
        stop_legacy_processes hub
        ;;
    restart)
        "$0" stop
        "$0" start
        ;;
    status)
        show_status
        ;;
    logs)
        tmux capture-pane -p -t "${HAPI_HUB_SESSION}" -S -240
        ;;
    *)
        printf 'Usage: %s {start|stop|restart|status|logs}\n' "$0" >&2
        exit 2
        ;;
esac
