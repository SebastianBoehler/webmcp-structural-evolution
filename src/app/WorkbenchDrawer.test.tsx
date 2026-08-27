import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { WorkbenchDrawer } from "./WorkbenchDrawer";

test("keeps panel state mounted while exposing only the selected review tab", () => {
  const onChange = vi.fn();
  render(<WorkbenchDrawer
    active="evidence"
    onChange={onChange}
    items={[
      { id: "evidence", label: "Evidence", content: <p>Measured output</p> },
      { id: "agents", label: "Agents", content: <p>Registration status</p> },
    ]}
  />);

  expect(screen.getByText("Measured output")).toBeVisible();
  expect(screen.getByText("Registration status")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Agents" }));
  expect(onChange).toHaveBeenCalledWith("agents");
});
