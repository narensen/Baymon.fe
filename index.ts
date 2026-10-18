// The OS can launch Baymon without any UI just to run its background check, so the task has to be
// defined before the router loads.
import './src/lib/nudges/engine';

import 'expo-router/entry';
