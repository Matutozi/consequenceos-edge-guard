/**
 * What the approval window can promise, and when it should say it cannot.
 *
 * The window is an extension page in its own window. The page that asked cannot reach it: page
 * code cannot script another origin's window, and an agent that works through the page (reading
 * and clicking its elements) only sees the page. An agent that drives the whole browser or
 * computer can: one that clicks by screenshot and mouse, or through Chrome's debugging
 * protocol, presses Allow as easily as a person. Nothing in a window tells those clicks apart
 * from a person's, so the window does not pretend to; when Chrome reports that it is being run
 * by automation, it says so plainly.
 */
export function automationWarning(nav: { webdriver?: boolean }): string | undefined {
  return nav.webdriver
    ? "This browser is being run by automation software. Software that runs the browser can press these " +
        "buttons too, so an Allow here may not have come from you. If you did not start that software, block this."
    : undefined;
}
