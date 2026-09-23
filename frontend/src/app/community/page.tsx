import { redirect } from "next/navigation";

import { routes } from "@/lib/workspaces";

export default function CommunityPage() {
  redirect(routes.community);
}
