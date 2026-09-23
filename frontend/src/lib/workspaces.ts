export type Workspace = "community" | "dao";

export const CURRENT_DAO = { name: "cTOKEN DAO", network: "Sepolia" } as const;

export const routes = {
  home: "/",
  community: "/community/buybacks",
  sell: "/community/buybacks/ctoken",
  dao: "/dao",
  treasury: "/dao/buybacks",
  report: "/buybacks/report",
} as const;

export function reportWorkspace(value: unknown): Workspace {
  return value === "dao" ? "dao" : "community";
}

export function workspaceForPath(pathname: string, reportOrigin?: unknown): Workspace | null {
  if (pathname === routes.report) return reportWorkspace(reportOrigin);
  if (pathname === "/community" || pathname.startsWith("/community/")) return "community";
  if (pathname === "/dao" || pathname.startsWith("/dao/")) return "dao";
  return null;
}

export function reportHref(workspace: Workspace) {
  return `${routes.report}?workspace=${workspace}`;
}

export function buybackHref(workspace: Workspace) {
  return workspace === "dao" ? routes.treasury : routes.sell;
}

export function workspaceLinks(workspace: Workspace) {
  return [
    ...(workspace === "dao" ? [{ href: routes.dao, label: "Overview", soon: false }] : []),
    { href: workspace === "dao" ? routes.treasury : routes.community, label: "Buybacks", soon: false },
    { href: `/${workspace}/vesting`, label: workspace === "community" ? "My vesting" : "Vesting", soon: true },
    { href: `/${workspace}/payroll`, label: workspace === "community" ? "My payroll" : "Payroll", soon: true },
  ];
}

export function isWorkspaceLinkActive(pathname: string, href: string) {
  if (href === routes.dao) return pathname === href;
  if (pathname === routes.report) return href === routes.community || href === routes.treasury;
  return pathname === href || pathname.startsWith(`${href}/`);
}
