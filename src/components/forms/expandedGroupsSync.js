/**
 * Debounced "send the latest value to the server" helper used by
 * TimezoneCombobox to push expanded-group changes to the user's account.
 *
 * Critical invariant: `flush()` MUST send the *most recently scheduled*
 * value, not the value that originally started the timer. An earlier
 * inline implementation captured stale state via a React closure on
 * mount, so unmounting mid-debounce could write the user's *initial*
 * groups back to the server and silently clobber a fresh edit. This
 * helper keeps "latest" in a plain JS variable that is updated on every
 * `schedule()` call, so flushing always sends what the user last did.
 *
 * See tests/expandedGroupsSync.test.js for the regression test.
 */
export function createExpandedGroupsSync({ delay = 400, send } = {}) {
    let timer = null;
    let latest;
    let pending = false;

    function fire() {
        timer = null;
        if (!pending) return;
        const value = latest;
        pending = false;
        latest = undefined;
        if (typeof send === "function") send(value);
    }

    return {
        schedule(value) {
            latest = value;
            pending = true;
            if (timer) clearTimeout(timer);
            timer = setTimeout(fire, delay);
        },
        flush() {
            if (timer) {
                clearTimeout(timer);
                fire();
            }
        },
        cancel() {
            if (timer) clearTimeout(timer);
            timer = null;
            pending = false;
            latest = undefined;
        },
        isPending() {
            return pending;
        },
    };
}
