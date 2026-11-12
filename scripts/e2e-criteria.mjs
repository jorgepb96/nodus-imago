/** Interact with the actual searchable, styled pickers, including nested popovers. */
export async function chooseCriteria(page, label, text, scope = page, multiple = false) {
  await scope.getByRole("button", { name: label, exact: true }).click();
  const list = page.getByRole("listbox", { name: label, exact: true });
  await list.getByRole("option").filter({ has: page.locator("strong", { hasText: new RegExp("^" + text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) }).click();
  if (multiple) await page.locator(".criteria-select-menu:popover-open").getByRole("button", { name: "Listo", exact: true }).click();
}
