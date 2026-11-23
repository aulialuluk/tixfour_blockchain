import { requireUser, json } from "@/lib/server";

export async function GET(req) {
  const user = await requireUser(req);
  if (!user) {
    return json({ user: null });
  }

  return json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role || "user",
    },
  });
}
