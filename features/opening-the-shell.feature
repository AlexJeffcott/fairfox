@browser
Feature: The empty shell opens on the smallest phone
  As the person who builds Fairfox
  I want the empty shell to open in a real browser 320px wide
  So that every later screen starts from a page known to draw on the smallest phone

  Step 0a: the shell has no sign-in, no unit and no data. It is built
  with Preact, Signals and polly. A test server serves its built files;
  the pointer serves it from step 7b. The browser is WebKit, with no
  stored data.

  Background:
    Given the built shell is served

  Scenario: The shell draws at 320px wide
    When the shell is opened on a screen 320px wide
    Then the shell shows the name "Fairfox"
    And nothing on the page is wider than the screen
    And the browser reports no error

  Scenario: With scripts turned off the shell shows no name
    Given a browser with scripts turned off
    When the shell is opened on a screen 320px wide
    Then the name "Fairfox" is not shown
