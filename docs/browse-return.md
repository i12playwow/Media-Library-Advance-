# Returning from playback

Library and Actresses keep their visited page mounted while the internal Player is shown. This preserves loaded poster pages, grouping preferences, actress search and filters, expanded lists, the selected actress, and profile movie filters. Inactive pages use display:none and are hidden from accessibility navigation.

Main-content and document scroll positions are remembered separately for each page during the app session. Returning from playback restores them after layout. Leaving Actresses no longer clears the selected profile. This feature does not change video playback checkpoints.

Validation: tests/runtime/browse-return.cjs uses 450 synthetic movies, loads more than one Library page, enters the built-in player, and verifies Library position and loaded cards. It also verifies actress directory search/position and profile selection/search/position across Player navigation. All fixtures use an isolated app profile.
