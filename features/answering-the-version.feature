@local
Feature: The server answers which commit it runs
  As the person who builds Fairfox
  I want the server to say which commit it runs
  So that a deploy can check that it shipped what it meant to ship

  Step 0a: no business logic. The server runs with an empty in-memory
  database, and nothing here reads it; step 0b proves the database.
  The commit is a setting with no default (C1), passed in by the test (C2).
  The client runs in the test's process (M9). The CLI runs as its own
  process and reaches the server over HTTP.

  Scenario Outline: The client reads the commit the server runs
    Given a server running commit "<commit>"
    When the client asks the server for its version
    Then the answer is the commit "<commit>"
    And the answer holds nothing but the commit

    Examples:
      | commit  |
      | 3f9c2e1 |
      | a07b5d4 |

  Scenario Outline: The CLI prints the commit the server runs
    Given a server running commit "<commit>"
    When the CLI's version command is run against that server
    Then the CLI prints the commit "<commit>"

    Examples:
      | commit  |
      | 3f9c2e1 |
      | a07b5d4 |

  Scenario: A server with no commit set does not start
    When a server is started with no commit set
    Then the server does not start
    And the error names the missing commit setting
