# Evidence: Next.js 16.3.4 client action queue (lines 50-170)

- Original path: `node_modules/.pnpm/next@16.3.4_@babel+core@7.29.7_@opentelemetry+api@1.9.1_@playwright+test@1.62.1_@types+_d3fc13dc71a9be8f6f1a487c4973fe9d/node_modules/next/dist/client/components/app-router-instance.js`
- Line range: 50-170
- Why included: server actions (and navigations) share one queue per client; a new action waits until the pending one settles (dispatchAction 'add to the end of the queue'). The duplex relays and the 1.5 s voice turn poll are server actions.

```js
   50  function runRemainingActions(actionQueue, settledAction, setState) {
   51      // Only advance the queue if the settled action is still at its head. If a
   52      // navigation discarded this action, the navigation took its place and is
   53      // still in flight — starting the next queued action now would run it
   54      // against router state that doesn't include the navigation yet.
   55      if (actionQueue.pending === settledAction) {
   56          actionQueue.pending = settledAction.next;
   57          if (actionQueue.pending !== null) {
   58              runAction({
   59                  actionQueue,
   60                  action: actionQueue.pending,
   61                  setState
   62              });
   63              return;
   64          }
   65      }
   66      if (actionQueue.pending === null && actionQueue.needsRefresh) {
   67          // The queue is idle; flush the refresh requested by a discarded server
   68          // action that revalidated data.
   69          actionQueue.needsRefresh = false;
   70          actionQueue.dispatch({
   71              type: _routerreducertypes.ACTION_REFRESH
   72          }, setState);
   73      }
   74  }
   75  async function runAction({ actionQueue, action, setState }) {
   76      const prevState = actionQueue.state;
   77      actionQueue.pending = action;
   78      const payload = action.payload;
   79      const actionResult = actionQueue.action(prevState, payload);
   80      function handleResult(nextState) {
   81          // if we discarded this action, the state should also be discarded
   82          if (action.discarded) {
   83              // Check if the discarded server action revalidated data
   84              if (action.payload.type === _routerreducertypes.ACTION_SERVER_ACTION && action.payload.didRevalidate) {
   85                  // The server action was discarded but it revalidated data,
   86                  // mark that we need to refresh after all actions complete
   87                  actionQueue.needsRefresh = true;
   88              }
   89              // This can't advance the queue (this action is no longer its head), but
   90              // if the queue has already drained, it flushes the refresh now.
   91              runRemainingActions(actionQueue, action, setState);
   92              return;
   93          }
   94          actionQueue.state = nextState;
   95          runRemainingActions(actionQueue, action, setState);
   96          action.resolve(nextState);
   97      }
   98      // if the action is a promise, set up a callback to resolve it
   99      if ((0, _isthenable.isThenable)(actionResult)) {
  100          actionResult.then(handleResult, (err)=>{
  101              runRemainingActions(actionQueue, action, setState);
  102              action.reject(err);
  103          });
  104      } else {
  105          handleResult(actionResult);
  106      }
  107  }
  108  function dispatchAction(actionQueue, payload, setState) {
  109      let resolvers = {
  110          resolve: setState,
  111          reject: ()=>{}
  112      };
  113      // most of the action types are async with the exception of restore
  114      // it's important that restore is handled quickly since it's fired on the popstate event
  115      // and we don't want to add any delay on a back/forward nav
  116      // this only creates a promise for the async actions
  117      if (payload.type !== _routerreducertypes.ACTION_RESTORE) {
  118          // Create the promise and assign the resolvers to the object.
  119          const deferredPromise = new Promise((resolve, reject)=>{
  120              resolvers = {
  121                  resolve,
  122                  reject
  123              };
  124          });
  125          (0, _react.startTransition)(()=>{
  126              // we immediately notify React of the pending promise -- the resolver is attached to the action node
  127              // and will be called when the associated action promise resolves
  128              setState(deferredPromise);
  129          });
  130      }
  131      const newAction = {
  132          payload,
  133          next: null,
  134          resolve: resolvers.resolve,
  135          reject: resolvers.reject
  136      };
  137      // Check if the queue is empty
  138      if (actionQueue.pending === null) {
  139          // The queue is empty, so add the action and start it immediately
  140          // Mark this action as the last in the queue
  141          actionQueue.last = newAction;
  142          runAction({
  143              actionQueue,
  144              action: newAction,
  145              setState
  146          });
  147      } else if (payload.type === _routerreducertypes.ACTION_NAVIGATE || payload.type === _routerreducertypes.ACTION_RESTORE) {
  148          // Navigations (including back/forward) take priority over any pending actions.
  149          // Mark the pending action as discarded (so the state is never applied) and start the navigation action immediately.
  150          actionQueue.pending.discarded = true;
  151          // The rest of the current queue should still execute after this navigation.
  152          // (Note that it can't contain any earlier navigations, because we always put those into `actionQueue.pending` by calling `runAction`)
  153          newAction.next = actionQueue.pending.next;
  154          if (actionQueue.last === actionQueue.pending) {
  155              actionQueue.last = newAction;
  156          }
  157          runAction({
  158              actionQueue,
  159              action: newAction,
  160              setState
  161          });
  162      } else {
  163          // The queue is not empty, so add the action to the end of the queue
  164          // It will be started by runRemainingActions after the previous action finishes
  165          if (actionQueue.last !== null) {
  166              actionQueue.last.next = newAction;
  167          }
  168          actionQueue.last = newAction;
  169      }
  170  }
```
