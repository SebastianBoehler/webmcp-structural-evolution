import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentBrowser } from "./ComponentBrowser";

const props = (onImportFile: (file: File) => void | Promise<void>) => ({
  selectedId: "arm-design-region",
  open: true,
  parts: [],
  onSelect: vi.fn(),
  onImportFile,
  onClose: vi.fn(),
});

afterEach(cleanup);

describe("ComponentBrowser local package import", () => {
  it("offers ZIP selection and sends a dropped local package through the import seam", () => {
    const onImportFile = vi.fn();
    render(<ComponentBrowser {...props(onImportFile)} />);
    const input = screen.getByLabelText("Choose local component file");
    const file = new File(["zip"], "motor.zip", { type: "application/zip" });

    expect(input.getAttribute("accept")).toContain(".zip");
    fireEvent.drop(screen.getByTestId("component-import-dropzone"), { dataTransfer: { files: [file] } });

    expect(onImportFile).toHaveBeenCalledWith(file);
  });

  it("shows package rejection instead of hiding an asynchronous import failure", async () => {
    render(<ComponentBrowser {...props(async () => { throw new Error("Package has no display representation"); })} />);

    fireEvent.change(screen.getByLabelText("Choose local component file"), {
      target: { files: [new File(["zip"], "broken.zip", { type: "application/zip" })] },
    });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Package has no display representation"));
  });
});
