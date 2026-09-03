import { DistributedR2APhysicalPatternLearnerV2 } from '../dist/src/core/learning/distributed-r2a.js';
import { scanAnonymousPhysicalStructureV1 } from '../dist/src/core/physics/distributed-physical-structure-scanner.js';
import { DistributedPhysicalMedium3DV1 } from '../dist/src/core/physics/distributed-physical-medium.js';
import { sha } from '../dist/src/util.js';

function event(branch, repetition) {
  const eventId=`${branch}-${repetition}`, q=branch==='target'?'channel-q:value-1':'channel-q:value-0';
  const s=`channel-s:value-${repetition%2}`, terminal=branch==='target'?[40,41,42,43]:[60,61,62,63];
  const pulseSiteIds=[[10,11,12,13],[20,21,22,23],terminal];
  return {version:'DistributedR2ContinuousEventV1',eventId,atomIds:[`${eventId}:prefix`,`${eventId}:action`],
    sourceEventIds:[`${eventId}:source-prefix`,`${eventId}:source-action`],orderedExperienceIdentities:['anonymous-prefix','anonymous-action'],
    orderedEpisodePatternIds:['anonymous-prefix-pattern','anonymous-action-pattern'],dependencyIds:['anonymous-process'],contextIds:[`context-${repetition%4}`],
    completion:'complete',boundaryReason:'public-process-resolved',learningEligible:true,
    physicalFootprint:{version:'DistributedTraceFootprintV1',traceId:`r2-${eventId}`,footprintId:`r2-${eventId}`,depositedAt:repetition,
      siteIds:[...new Set(pulseSiteIds.flat())],pulseSiteIds,bondReferences:[{fromSiteId:10,toSiteId:20,kind:'plastic-directed'},{fromSiteId:20,toSiteId:terminal[0],kind:'plastic-directed'}],directedBondIds:[`10->20`,`20->${terminal[0]}`],pulseCount:3,supportMass:1},
    processChanges:[{subject:'anonymous-result',property:'opaque-state',before:false,after:branch==='target',observationIndex:repetition*10+4,meaning:'observed-co-occurrence'}],
    terminalChanges:[{subject:'anonymous-result',property:'opaque-state',before:false,after:branch==='target',observationIndex:repetition*10+4,meaning:'observed-co-occurrence'}],
    beforePublicSignals:['channel-common:value-1',q,s],beforeSignalTimeline:[['channel-common:value-1'],['channel-common:value-1',q,s]],
    physicalPulseSiteIds:pulseSiteIds,atomPulseRanges:[{atomId:`${eventId}:prefix`,startPulseIndex:0,endPulseIndexExclusive:1},{atomId:`${eventId}:action`,startPulseIndex:1,endPulseIndexExclusive:3}],patternSha256:sha({version:'anonymous-audit-only',branch})};
}
const learner=new DistributedR2APhysicalPatternLearnerV2(()=>true);
for(let i=0;i<8;i++){learner.observe(event('target',i));learner.observe(event('contrast',i));}
const state=learner.snapshot(), scan=scanAnonymousPhysicalStructureV1(state.medium), input=state.eventInputs.find(v=>v.eventId==='target-0');
const terminal=scan.terminalAttractors.find(v=>input&&v.coreSiteIds.some(id=>input.terminalPulseSiteIds.includes(id)));
const snapshot={...state.medium,sites:state.medium.sites.map(site=>({...site,activation:0}))};
const readout=DistributedPhysicalMedium3DV1.fromSnapshot(snapshot).probe(terminal.coreSiteIds,0x4450524fn,180);
const basinFor=id=>scan.basins.find(b=>b.coreSiteIds.includes(id))?.basinId??null;
console.log(JSON.stringify({terminal,core:readout.coreSiteIds.map(siteId=>({siteId,basin:basinFor(siteId),potential:snapshot.sites[siteId].potentialDepth,support:snapshot.sites[siteId].supportMass})),ambiguous:readout.ambiguous,dwell:readout.dwellSteps,escape:readout.escapeRate,allTerminals:scan.terminalAttractors.map(v=>({id:v.attractorId,sites:v.coreSiteIds}))},null,2));
