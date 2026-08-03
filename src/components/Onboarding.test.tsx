import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  it("renders the legend and keyboard-shortcut sections", () => {
    render(<Onboarding onClose={vi.fn()} />);
    expect(screen.getByText("Reading the graph")).toBeInTheDocument();
    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("calls onClose when the 'Got it' button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Onboarding onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Onboarding onClose={onClose} />);
    await user.click(container.querySelector(".onboarding-backdrop")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose when the dialog body itself is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Onboarding onClose={onClose} />);
    await user.click(screen.getByText("Reading the graph"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Onboarding onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
