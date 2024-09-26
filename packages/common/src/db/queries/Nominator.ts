import { CandidateModel, Nominator, NominatorModel } from "../models";
import logger from "../../logger";
import { getCandidateByStash } from "./Candidate";

/**
 * Removes any stale nominator data from the database.
 * @param controllers Active controller accounts for nominators.
 */
export const removeStaleNominators = async (
  controllers: string[],
): Promise<boolean> => {
  const nominators = await allNominators();
  const addresses = nominators.map((n) => n.address);
  // for each address
  for (const address of addresses) {
    // if it's not found in the active controllers
    if (controllers.indexOf(address) === -1) {
      // remove the stale item from the DB
      await NominatorModel.deleteOne({ address }).exec();
    }
  }

  return true;
};

/** Nominator accessor functions */
export const addNominator = async (nominator: Nominator): Promise<boolean> => {
  try {
    const {
      address,
      stash,
      proxy,
      bonded,
      now,
      proxyDelay,
      rewardDestination,
    } = nominator;
    const data = await NominatorModel.findOne({ address }).lean<Nominator>();
    if (!data) {
      const nominator = new NominatorModel({
        address,
        stash,
        proxy,
        bonded,
        proxyDelay,
        rewardDestination,
        current: [],
        lastNomination: 0,
        createdAt: now,
      });
      await nominator.save();
      return true;
    }

    await NominatorModel.findOneAndUpdate(
      {
        address,
      },
      {
        createdAt: now,
        stash,
        proxy,
        bonded,
        proxyDelay,
        rewardDestination,
      },
    );
    return true;
  } catch (e) {
    logger.info(JSON.stringify(e));
    logger.error(`Could not add nominator: ${JSON.stringify(nominator)}`);
    return false;
  }
};

export const setTarget = async (
  address: string,
  target: string,
  era: number,
): Promise<boolean> => {
  logger.info(`(Db::setTarget) Setting ${address} with new target ${target}.`);

  await CandidateModel.findOneAndUpdate(
    {
      stash: target,
    },
    {
      nominatedAt: era,
    },
  ).exec();

  const candidate = await getCandidateByStash(target);
  if (!candidate) {
    logger.info(
      `(Db::setTarget) getCandidate returned null for ${target}. Deleted candidate?`,
    );
    return false;
  }
  const currentCandidate = {
    name: candidate.name,
    stash: candidate.stash,
    identity: candidate.identity,
  };

  await NominatorModel.findOneAndUpdate(
    {
      address,
    },
    {
      $push: { current: currentCandidate },
    },
  ).exec();

  return true;
};

export const clearCurrent = async (address: string): Promise<boolean> => {
  logger.info(`(Db::clearCurrent) Clearing current for ${address}.`);

  await NominatorModel.findOneAndUpdate(
    {
      address,
    },
    {
      current: [],
    },
  ).exec();

  return true;
};

export const setLastNomination = async (
  address: string,
  now: number,
): Promise<boolean> => {
  await NominatorModel.findOneAndUpdate(
    {
      address,
    },
    {
      $set: { lastNomination: now },
    },
  ).exec();
  return true;
};

export const getCurrentTargets = async (
  address: string,
): Promise<{ name?: string; stash?: string; identity?: any }[]> => {
  try {
    const nominator = await NominatorModel.findOne({
      address,
    }).lean<Nominator>();
    if (nominator) {
      return nominator?.current || [];
    } else {
      return [];
    }
  } catch (e) {
    logger.error(JSON.stringify(e));
    return [];
  }
};

export const allNominators = async (): Promise<Nominator[]> => {
  return NominatorModel.find({}).lean<Nominator[]>();
};

export const getNominator = async (
  stash: string,
): Promise<Nominator | null> => {
  return NominatorModel.findOne({ stash: stash }).lean<Nominator>();
};
