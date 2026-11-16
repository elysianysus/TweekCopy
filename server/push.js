import webpush from "web-push";
import { db } from "./db.js";
import { pushSubscriptions, tasks } from "./schema.js";
import { eq, and, lte, isNotNull, sql } from "drizzle-orm";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || "mailto:admin@analogue-planner.app";

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

export function getVapidPublicKey() {
  return VAPID_PUBLIC || null;
}

export async function saveSubscription(uid, subscription) {
  const existing = await db.select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
  if (existing.length > 0) {
    await db.update(pushSubscriptions)
      .set({ uid, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth })
      .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
    return;
  }
  await db.insert(pushSubscriptions).values({
    uid,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  });
}

export async function removeSubscription(uid, endpoint) {
  await db.delete(pushSubscriptions).where(
    and(eq(pushSubscriptions.uid, uid), eq(pushSubscriptions.endpoint, endpoint))
  );
}

export async function sendPushToUser(uid, payload) {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.uid, uid));
  const failed = [];
  for (const sub of subs) {
    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      await webpush.sendNotification(pushSub, JSON.stringify(payload));
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        failed.push(sub.id);
      }
    }
  }
  if (failed.length > 0) {
    for (const id of failed) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    }
  }
}

const notifiedReminders = new Set();

export async function checkReminders() {
  try {
    const now = new Date();
    const nowLocal = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + 'T' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
    const dueTasksResult = await db.select({
      id: tasks.id,
      uid: tasks.uid,
      name: tasks.name,
      reminder: tasks.reminder,
    })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.reminder),
          eq(tasks.done, false),
          lte(tasks.reminder, nowLocal)
        )
      );

    for (const task of dueTasksResult) {
      const key = `${task.id}-${task.reminder}`;
      if (notifiedReminders.has(key)) continue;

      const reminderTime = new Date(task.reminder);
      const diffMs = now.getTime() - reminderTime.getTime();
      if (diffMs > 30 * 60 * 1000) {
        notifiedReminders.add(key);
        continue;
      }

      notifiedReminders.add(key);
      await sendPushToUser(task.uid, {
        title: "Task Reminder",
        body: task.name || "You have a task due!",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        data: { taskId: task.id },
      });
    }

    if (notifiedReminders.size > 5000) {
      const arr = Array.from(notifiedReminders);
      arr.splice(0, 2500);
      notifiedReminders.clear();
      arr.forEach(k => notifiedReminders.add(k));
    }
  } catch (err) {
    console.error("Push reminder check error:", err.message);
  }
}

let reminderInterval = null;

export function startReminderChecker() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.log("VAPID keys not set, push notifications disabled");
    return;
  }
  reminderInterval = setInterval(checkReminders, 60 * 1000);
  checkReminders();
  console.log("Push notification reminder checker started");
}
