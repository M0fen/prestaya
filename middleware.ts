import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Solo las áreas internas pasan por el middleware de sesión. La vista de
// cliente (por token, sin login) y el login mismo quedan intactos.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*", "/cobrador/:path*"],
};
