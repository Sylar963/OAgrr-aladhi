import { render, screen } from "@testing-library/react";

import Home from "./page";

describe("landing page", () => {
  it("renders the hero headline and CTA", () => {
    render(Home());

    expect(
      screen.getByRole("heading", { name: "Stop venue hopping." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request Access" })).toBeInTheDocument();
  });
});
