// Author: David Matura

// Lets work that waits on nothing but other promises run on, as the engine's answers come a few promise turns after a
// call: enough turns for any chain a test starts to run its course, until it waits on something more.
export async function promisesRun(turns = 100): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await Promise.resolve()
  }
}
