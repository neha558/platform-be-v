import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaginatedDTO } from 'src/app/common/dto/paginated.dto';
import { configService } from 'src/app/config/config.service';
import { DatabaseService } from 'src/app/database/database.service';
import { PackBought, PackBoughtStatus } from 'src/models/packBought.entity';
import { Rank } from 'src/models/rank.entity';
import { User } from 'src/models/user.entity';
import { BonusTypes } from 'src/models/userBonus.entity';
import { In, LessThanOrEqual, Raw } from 'typeorm';
import * as moment from 'moment';

const teamMatchingBonusPercentage = 7;

@Injectable()
export class BonusService {
  constructor(private readonly databaseService: DatabaseService) {}

  async userRepository() {
    return this.databaseService.getUserRepository();
  }

  async rankRepository() {
    return this.databaseService.getRankRepository();
  }

  async userBonusRepository() {
    return this.databaseService.getUserBonusRepository();
  }

  async packRepository() {
    return this.databaseService.getPackRepository();
  }

  async packBoughtRepository() {
    return this.databaseService.getPackBoughtRepository();
  }

  async userBusinessRepository() {
    return this.databaseService.getUserBusinessRepository();
  }

  async updateSponsorsIncome(sponsors: User[], user, packDetails: PackBought) {
    const userRepo = await this.userRepository();
    const userBusinessRepo = await this.userBusinessRepository();

    const userBusinessRepoEntries = sponsors?.map((sponsor, index) => {
      // based on next child decide which tree needs to be updated
      const nextChildInTree = sponsors?.[index + 1] ?? user;
      // update team income
      const isFirstTeam = nextChildInTree?.node === 0;

      return {
        node: isFirstTeam ? 0 : 1,
        accountAddress: sponsor?.accountAddress,
        businessIncome: packDetails?.packPrice,
        joinedByAccountAddress: user?.accountAddress,
      };
    });

    // traverse tree upwards and increment business income
    const userRepoEntries = sponsors?.map((sponsor, index) => {
      Logger.log(
        `U: ${user?.accountAddress} P:${packDetails?.pack?._id}: BONUS ${sponsor?.accountAddress}: PARENT BUSINESS - ${packDetails?.packPrice}`,
      );

      // based on next child decide which tree needs to be updated
      const nextChildInTree = sponsors?.[index + 1] ?? user;
      // update team income
      const isFirstTeam = nextChildInTree?.node === 0;

      return {
        id: sponsor?.id,
        rankBusinessATeamBucket: isFirstTeam
          ? sponsor?.rankBusinessATeamBucket + packDetails?.packPrice
          : sponsor?.rankBusinessATeamBucket,
        rankBusinessBTeamBucket: !isFirstTeam
          ? sponsor?.rankBusinessBTeamBucket + packDetails?.packPrice
          : sponsor?.rankBusinessBTeamBucket,
        businessIncome: sponsor?.businessIncome + packDetails?.packPrice,
        businessIncomeFirstTeam: isFirstTeam
          ? sponsor?.businessIncomeFirstTeam + packDetails?.packPrice
          : sponsor?.businessIncomeFirstTeam,
        businessIncomeSecondTeam: !isFirstTeam
          ? sponsor?.businessIncomeSecondTeam + packDetails?.packPrice
          : sponsor?.businessIncomeSecondTeam,
        teamACount: isFirstTeam ? sponsor?.teamACount + 1 : sponsor?.teamACount,
        teamBCount: !isFirstTeam
          ? sponsor?.teamBCount + 1
          : sponsor?.teamBCount,
      };
    });

    await Promise.all([
      userBusinessRepo.save(userBusinessRepoEntries),
      userRepo.save(userRepoEntries),
    ]);
  }

  async updateUserIndividualIncome(user, packDetails: PackBought) {
    const userRepo = await this.userRepository();

    // increment user individualIncome
    await userRepo.update(
      {
        id: user?.id,
      },
      {
        individualIncome: user?.individualIncome + packDetails?.packPrice,
      },
    );

    Logger.log(
      `U: ${user?.accountAddress} P:${packDetails?.pack?._id}: BONUS ${user?.accountAddress}: INDIVIDUAL BONUS - ${packDetails?.packPrice}`,
    );
  }

  async updateTeamMatchingSponsorBonus(
    user: User,
    sponsors: User[],
    packDetails: PackBought,
  ) {
    const userRepo = await this.userRepository();
    const bonusRepo = await this.userBonusRepository();

    const userRepoEntries = sponsors
      ?.map((sponsor) => {
        // based on level provide team direct bonus
        // based on level provide team matching direct bonus
        const firstTeamIncome =
          sponsor?.businessIncomeFirstTeam -
          sponsor?.businessIncomeFirstDeltaTeam;
        const secondTeamIncome =
          sponsor?.businessIncomeSecondTeam -
          sponsor?.businessIncomeSecondDeltaTeam;

        Logger.log(
          `U: ${user?.accountAddress} P:${packDetails?.pack?._id}: TEAM MATCHING BONUS INCOME CHECK ${sponsor?.accountAddress}:
        firstTeamIncome: ${firstTeamIncome}
        secondTeamIncome: ${secondTeamIncome}
        `,
        );
        if (secondTeamIncome <= 0 || firstTeamIncome <= 0) {
          return null;
        }

        const eligibleIncomeForMatching =
          firstTeamIncome > secondTeamIncome
            ? secondTeamIncome
            : firstTeamIncome;

        const teamMatchingSponsorBonus =
          eligibleIncomeForMatching * (teamMatchingBonusPercentage / 100);

        let teamMatchingDirectSponsorBonus = 0;

        // not root as well
        if (
          user?.sponsorTree?.includes(sponsor?.accountAddress)
          // &&
          // sponsor?.accountAddress !==
          //   user?.sponsorTree?.[user?.sponsorTree.length - 1]
        ) {
          // add on matching will be not given to user who referred this sponsor
          teamMatchingDirectSponsorBonus =
            teamMatchingSponsorBonus *
            (sponsor?.profile?.directSponsorBonus / 100);
        }

        Logger.log(
          `------------------------ BINARY DISTRIBUTION ------------------------ ${user?.accountAddress?.toLowerCase()}-${
            packDetails?.pack?._id
          }`,
        );
        Logger.log(
          ` U: ${user?.accountAddress} 
            P:${packDetails?.pack?._id}: 
            Binary tp ${sponsor?.accountAddress}:
            Add On matching to accountAddress ${sponsor?.referredBy?.accountAddress}:
            eligibleIncomeForMatching: ${eligibleIncomeForMatching}
            teamMatchingSponsorBonus: ${teamMatchingSponsorBonus}
            teamMatchingDirectSponsorBonus: ${teamMatchingDirectSponsorBonus}
        `,
        );
        Logger.log(
          '------------------------ BINARY DISTRIBUTION ------------------------',
        );

        return {
          id: sponsor?.id,
          referredBy: sponsor?.referredBy,
          businessIncomeSecondDeltaTeam:
            sponsor?.businessIncomeSecondDeltaTeam + eligibleIncomeForMatching,
          businessIncomeFirstDeltaTeam:
            sponsor?.businessIncomeFirstDeltaTeam + eligibleIncomeForMatching,
          teamMatchingBonus:
            teamMatchingSponsorBonus > 0
              ? sponsor.teamMatchingBonus + teamMatchingSponsorBonus
              : sponsor.teamMatchingBonus,
          directMatchingBonus:
            teamMatchingDirectSponsorBonus > 0
              ? sponsor?.directMatchingBonus + teamMatchingDirectSponsorBonus
              : sponsor?.directMatchingBonus,
          teamMatchingSponsorBonus,
          teamMatchingDirectSponsorBonus,
          sponsor,
          teamMatchingBonusPercentage,
        };
      })
      .filter((_d) => _d?.id);

    const teamMatchingSponsorBonusEntries = userRepoEntries
      ?.filter((_userRepoEntries) => {
        return _userRepoEntries.teamMatchingSponsorBonus > 0;
      })
      .map((_userRepoEntry) => {
        return {
          amount: _userRepoEntry.teamMatchingSponsorBonus,
          bonusFrom: user,
          bonusType: BonusTypes.team,
          user: _userRepoEntry.sponsor,
          packBought: packDetails,
          userLevel: _userRepoEntry.sponsor?.profile?._id,
          percentage: _userRepoEntry.teamMatchingBonusPercentage,
          canClaim: false,
          flushAmount: 0,
        };
      });

    const teamMatchingDirectSponsorBonusEntries = userRepoEntries
      ?.filter((_userRepoEntries) => {
        return (
          _userRepoEntries.teamMatchingDirectSponsorBonus > 0 &&
          _userRepoEntries.referredBy?.id
        );
      })
      .map((_userRepoEntry) => {
        return {
          amount: _userRepoEntry.teamMatchingDirectSponsorBonus,
          bonusFrom: user,
          bonusType: BonusTypes.teamDirect,
          user: _userRepoEntry.referredBy,
          packBought: packDetails,
          userLevel: _userRepoEntry.referredBy?.profile?._id,
          percentage: _userRepoEntry.referredBy?.profile?.directSponsorBonus,
          canClaim: false,
          flushAmount: 0,
        };
      });

    for (const _userRepoEntries of userRepoEntries) {
      if (_userRepoEntries?.teamMatchingDirectSponsorBonus > 0) {
        await userRepo.save({
          id: _userRepoEntries?.referredBy?.id,
          directMatchingBonus: _userRepoEntries?.directMatchingBonus,
        });

        delete _userRepoEntries.directMatchingBonus;
        await userRepo.save({
          ..._userRepoEntries,
          id: _userRepoEntries?.id,
          directMatchingBonus: undefined,
        });
      } else {
        await userRepo.save(_userRepoEntries);
      }
    }

    await Promise.all([
      bonusRepo.save(teamMatchingSponsorBonusEntries),
      bonusRepo.save(teamMatchingDirectSponsorBonusEntries),
    ]);
  }

  async updateDirectSponsorBonus(
    user: User,
    sponsors: User[],
    packDetails: PackBought,
  ) {
    const userRepo = await this.userRepository();

    await Promise.all(
      sponsors.map((sponsor) => {
        const directSponsorBonus =
          packDetails?.packPrice * (sponsor?.profile?.directSponsorBonus / 100);

        if (!sponsor?.id) {
          return Promise.all([Promise.resolve()]);
        }
        // check if last bought pack is _id 1 then don't provide any binary and not root user
        if (
          sponsor.referredBy &&
          (sponsor?.lastBoughtPack < 0 || sponsor?.lastBoughtPack === 1)
        ) {
          return Promise.all([Promise.resolve()]);
        }

        Logger.log(
          `U: ${user?.accountAddress} P:${packDetails?.pack?._id}: BONUS ${sponsor?.accountAddress}: DIRECT SPONSOR BUSINESS - ${directSponsorBonus}`,
        );
        return Promise.all([
          userRepo.update(
            {
              id: sponsor?.id,
            },
            {
              directSponsorBonus:
                sponsor?.directSponsorBonus + directSponsorBonus,
            },
          ),
          this.makeEntryInBonus(
            directSponsorBonus,
            user,
            BonusTypes.direct,
            sponsor,
            packDetails,
            sponsor?.profile?.directSponsorBonus,
            sponsor?.level,
            true,
          ),
        ]);
      }),
    );
  }

  async updateUserProfileAndRankBonus(user: User, packDetails: PackBought) {
    // @todo check rank logic here
    return;
    const existingProfile = user?.profile;
    const userRepo = await this.userRepository();
    const newRank = await this.getUserCurrentLevel(user);

    if (existingProfile?._id >= newRank?.id) {
      return;
    }

    // increment user individualIncome
    const saved = await userRepo.save({
      id: user?.id,
      profile: newRank,
      rankBusinessATeamBucket:
        user?.rankBusinessATeamBucket - newRank?.minimumBusinessRequired,
      rankBusinessBTeamBucket:
        user?.rankBusinessBTeamBucket - newRank?.minimumBusinessRequired,
    });

    Logger.log(
      `U: ${user?.accountAddress} P:${packDetails?.pack?._id}: BONUS ${user?.accountAddress}: UPDATE RANK EXIST - ${saved?.profile?.id} - NEW ${newRank?.rankBonus}`,
    );

    if (saved.profile?.id !== existingProfile?.id) {
      // add rank bonus

      await userRepo.update(
        {
          id: user?.id,
        },
        {
          rankBonus: user?.rankBonus + newRank?.rankBonus,
        },
      );

      await this.makeEntryInBonus(
        newRank?.rankBonus,
        user,
        BonusTypes.rank,
        user,
        packDetails,
        0,
        user?.level,
        true,
      );
    }
  }

  async getUserCurrentLevel(userGiven: User): Promise<Rank> {
    const userRepo = await this.userRepository();

    const user = await userRepo.findOne({
      where: { id: userGiven?.id },
      relations: ['profile', 'parent'],
    });

    // check teamA and teamB Business
    const teamABusiness = user.rankBusinessATeamBucket;
    const teamBBusiness = user.rankBusinessBTeamBucket;

    const queryTeamCount = `SELECT COUNT(distinct id) as amount, node FROM cubix.module_networking_users where sponsorTree LIKE '%${user.accountAddress}%' group by node ORDER BY node;`;

    const [directSponsor, teamWiseSponsorCount] = await Promise.all([
      userRepo.count({
        where: {
          referredBy: {
            id: userGiven.id,
          },
        },
      }),
      userRepo.query(queryTeamCount),
    ]);

    const teamACount = teamWiseSponsorCount?.[0].amount ?? 0;
    const teamBCount = teamWiseSponsorCount?.[1].amount ?? 0;
    const matchingAmount =
      teamABusiness > teamBBusiness ? teamBBusiness : teamABusiness;

    // 4.Team A and Team B ma 1 1 Sponsor hovo joiye nahi mani lo ke Team A ma 3 sponsor kari didha and Team B ma aek pan sponsor nathi to pan Rank nahi male
    //     2. Associate rank pachina bija rank ma direct sponsor hova joiye like star rank ma 3 direct sponsor silver rank ma 4 (3 already che +1 new total 4) aevi rite 1 sponsor vadhto jase
    // Star 3
    // Silver 4
    // Gold 5
    // Platinum 6
    // Sapphire 7 aevi rite badha rank ma
    if (
      teamACount <= 0 ||
      teamBCount <= 0 ||
      directSponsor <= 0 ||
      matchingAmount <= 0
    ) {
      return user?.profile;
    }
    const rankRepo = await this.rankRepository();
    const supposedRank = await rankRepo.findOne({
      where: {
        minimumBusinessRequired: LessThanOrEqual(matchingAmount),
        directSponsorRequired: LessThanOrEqual(directSponsor),
      },
      order: {
        minimumBusinessRequired: 'DESC',
      },
    });

    Logger.log(`
      LEVEL LOGIC: ${user?.accountAddress}: ${user?.profile?._id}
      DIRECT SPONSOR: ${directSponsor}
      Team Matching: ${matchingAmount}
      Team A count: ${teamACount}
      Team B count: ${teamBCount}
    `);

    if (supposedRank?._id <= user?.profile?._id) {
      return user?.profile;
    }

    return supposedRank;
  }

  async makeEntryInBonus(
    amount: number,
    bonusFrom: User | null,
    bonusType: BonusTypes = BonusTypes.direct,
    user: User | null,
    packBought: PackBought,
    percentage: number,
    userLevel: number,
    canClaim,
  ) {
    const bonusRepo = await this.userBonusRepository();
    const userRepo = await this.userRepository();

    const userCurrentLevel = await userRepo.findOne({
      where: { id: user?.id },
      relations: ['profile'],
    });

    await bonusRepo.save({
      amount,
      bonusFrom,
      bonusType,
      user,
      packBought,
      userLevel: userCurrentLevel?.profile?._id,
      percentage,
      canClaim,
      flushAmount: 0,
    });

    if (canClaim) {
      // also increment user withdrawable amount
      await userRepo.update(
        {
          id: user?.id,
        },
        {
          totalWithdrawableAmount:
            (user?.totalWithdrawableAmount ?? 0) + amount,
        },
      );
    }
  }

  async getChildPartnersUsers(accountAddress: string): Promise<Array<User>> {
    let partners = [];
    const userRepo = await this.userRepository();
    const user = await userRepo.findOne({
      select: ['id', 'accountAddress', 'createDateTime'],
      relations: ['profile'],
      where: {
        accountAddress: Raw(
          (alias) =>
            `LOWER(${alias}) = '${String(accountAddress).toLowerCase()}'`,
        ),
      },
    });

    const children = await userRepo.find({
      select: ['id', 'accountAddress', 'createDateTime'],
      relations: ['profile'],
      where: {
        parent: {
          id: user?.id,
        },
      },
    });
    partners = children;

    if (children.length <= 0) {
      return partners;
    }

    for (const child of children) {
      const data = await this.getChildPartnersUsers(child.accountAddress);
      partners = [...partners, ...data];
    }
    return partners;
  }

  async getPatentTree(accountAddress: string, idOfStar: number) {
    const userRepo = await this.userRepository();

    const userDetails = await userRepo.findOne({
      select: ['id', 'parents'],
      where: {
        accountAddress: accountAddress?.toLowerCase(),
      },
      relations: ['profile'],
    });

    const parents = await userRepo.find({
      where: {
        accountAddress: In(userDetails?.parents),
        profile: {
          _id: idOfStar,
        },
      },
    });

    return parents;
  }

  async getUserBonus(accountAddress, query): Promise<PaginatedDTO> {
    const bonusRepo = await this.userBonusRepository();

    const userRepo = await this.userRepository();
    const user = await userRepo.findOneOrFail({
      where: {
        accountAddress: accountAddress?.toLowerCase(),
      },
    });

    let where = {
      user: {
        id: user?.id,
      },
    };

    if (query?.where) {
      where = {
        ...where,
        ...query.where,
      };
    }

    const [records, total] = await bonusRepo.findAndCount({
      ...query,
      where,
    });

    return { records, total };
  }

  async getUserPacks(accountAddress, query): Promise<PaginatedDTO> {
    const userRepo = await this.userRepository();
    const packBoughtRepo = await this.packBoughtRepository();
    const user = await userRepo.findOneOrFail({
      where: {
        accountAddress: accountAddress?.toLowerCase(),
      },
    });

    const [records, total] = await packBoughtRepo.findAndCount({
      where: {
        user: {
          id: user?.id,
        },
      },
      ...query,
    });

    return { records, total };
  }

  async getAllUndistributedPacks(query: any): Promise<PaginatedDTO> {
    const packBoughtRepo = await this.packBoughtRepository();

    const [records, total] = await packBoughtRepo.findAndCount({
      where: {
        txHash: null,
        status: PackBoughtStatus.paid,
      },
      ...query,
    });

    return { records, total };
  }

  // every mid night
  @Cron('0 0 * * *')
  async cronForBinaryIncomeUpdate() {
    try {
      if (configService.getDisableCron()) {
        return;
      }
      const bonusRepo = await this.userBonusRepository();

      const userRepo = await this.userRepository();

      const notYetGivenBonus = await bonusRepo.find({
        where: {
          canClaim: false,
        },
        relations: ['user', 'user.profile'],
      });

      for (const _notYetGivenBonus of notYetGivenBonus) {
        const userDetails = await userRepo.findOne({
          where: { id: _notYetGivenBonus?.user.id },
        });

        if (_notYetGivenBonus?.user?.lastBoughtPack) {
          if (_notYetGivenBonus.bonusType === BonusTypes.team) {
            const lastPackPrice = userDetails?.lastBoughtPackPrice;
            const flushAmount = _notYetGivenBonus?.amount - lastPackPrice;
            const dataToUpdateForBonus: any = {
              onHold: true,
              canClaim: true,
              amount: _notYetGivenBonus?.amount,
            };

            if (flushAmount > 0) {
              dataToUpdateForBonus.flushAmount = flushAmount;
              dataToUpdateForBonus.amount =
                _notYetGivenBonus?.amount - flushAmount;
            }

            if (userDetails?.teamACount >= 1 && userDetails?.teamBCount >= 1) {
              dataToUpdateForBonus.onHold = false;
            }

            Logger.log(
              `Binary BONUS UPDATES | ${
                userDetails?.accountAddress
              } | lastPackPrice - ${
                userDetails?.lastBoughtPackPrice
              } | flush Amount - ${flushAmount} | teamACount - ${
                userDetails?.teamACount
              } | teamBCount - ${
                userDetails?.teamBCount
              } | totalWithdrawableAmount - ${
                userDetails?.totalWithdrawableAmount
              } | ${JSON.stringify(dataToUpdateForBonus)}`,
            );
            if (
              !dataToUpdateForBonus.onHold &&
              dataToUpdateForBonus.amount > 0
            ) {
              Logger.log(
                `Binary BONUS UPDATES | UPDATES | ${userDetails?.id} | ${dataToUpdateForBonus.amount}`,
              );
              // increment totalWithdrawableAmount
              await userRepo.update(
                {
                  id: userDetails?.id,
                },
                {
                  totalWithdrawableAmount:
                    (userDetails?.totalWithdrawableAmount ?? 0) +
                    dataToUpdateForBonus.amount,
                },
              );
            }
            // update bonus entry
            await bonusRepo.update(
              { id: _notYetGivenBonus?.id },
              dataToUpdateForBonus,
            );
          }

          if (_notYetGivenBonus.bonusType === BonusTypes.teamDirect) {
            Logger.log(
              `Matching Binary BONUS UPDATES | ${userDetails?.accountAddress} | Amount - ${_notYetGivenBonus.amount}`,
            );
            // increment totalWithdrawableAmount
            await userRepo.update(
              {
                id: userDetails?.id,
              },
              {
                totalWithdrawableAmount:
                  (userDetails?.totalWithdrawableAmount ?? 0) +
                  _notYetGivenBonus.amount,
              },
            );
            await bonusRepo.update(
              { id: _notYetGivenBonus?.id },
              {
                canClaim: true,
              },
            );
          }
        }
      }
    } catch (error) {
      Logger.log('Error in cron');
      console.log(error);
    }
  }

  async syncTotalWithdrawable() {
    const bonusRepo = await this.userBonusRepository();

    const userWithdrawalRepo =
      await this.databaseService.getUserWithdrawalRepository();

    const existingReq = await userWithdrawalRepo.query(
      `SELECT SUM(amount) as amount, userId  FROM cubix.module_networking_user_withdrawal where status='success' group by userId`,
    );

    const claimableAmount = await bonusRepo.query(
      `SELECT SUM(amount) as amount, userId FROM cubix.module_networking_user_bonus where canClaim=true and onHold=false group by userId;`,
    );

    const userDetails = await bonusRepo.query(
      `SELECT totalWithdrawableAmount, id, account_address, email FROM cubix.module_networking_users;`,
    );

    const data = userDetails.map((_userDetails) => {
      const totalClaimableAmount = parseFloat(
        (
          claimableAmount.find(
            (_claimableAmount) => _claimableAmount.userId === _userDetails.id,
          )?.amount || 0
        ).toFixed(2),
      );

      const requestedWithdrawal = parseFloat(
        (
          existingReq.find(
            (_existingReq) => _existingReq.userId === _userDetails.id,
          )?.amount || 0
        ).toFixed(2),
      );
      return {
        ..._userDetails,
        totalClaimableAmount,
        requestedWithdrawal,
        pendingFromUs:
          totalClaimableAmount -
          (requestedWithdrawal +
            parseFloat((_userDetails.totalWithdrawableAmount || 0).toFixed(2))),
        extra: totalClaimableAmount - requestedWithdrawal,
      };
    });

    return data;
  }

  async stats(query) {
    const userRepo = await this.userRepository();
    const user = await userRepo.findOne({ where: { id: query.userId } });
    const bonusRepo = await this.userBonusRepository();
    const before24Hours = moment()
      .subtract(query.amount ?? 24, query.time ?? 'hours')
      .format('YYYY-MM-DDTHH:mm:ss');

    const querySponsor = `SELECT SUM(amount) as amount FROM cubix.module_networking_user_bonus where bonusType='direct' and userId='${query.userId}' and createDateTime >='${before24Hours}';`;
    const queryTeamBonus = `SELECT SUM(amount) as amount FROM cubix.module_networking_user_bonus where bonusType='team' and userId='${query.userId}' and createDateTime >='${before24Hours}';`;
    const queryTeamMatchingBonus = `SELECT SUM(amount) as amount FROM cubix.module_networking_user_bonus where bonusType='team_direct' and userId='${query.userId}' and createDateTime >='${before24Hours}';`;
    const queryDirectBonus = `SELECT COUNT(id) as amount FROM cubix.module_networking_users where referredById='${query.userId}' and createDateTime >='${before24Hours}';`;
    const queryDirectInvestmentBonus = `SELECT SUM(packPrice) as amount FROM cubix.module_networking_pack_bought where userId='${query.userId}' and createDateTime >='${before24Hours}';`;
    const queryTeamBusiness = `SELECT SUM(businessIncome) as amount, node FROM cubix.module_networking_user_business where account_address='${user.accountAddress}' and createDateTime >='${before24Hours}' group by node;`;
    const queryTeamCount = `SELECT COUNT(distinct id) as amount, node FROM cubix.module_networking_users where (parents LIKE '%${user.accountAddress}%' OR sponsorTree LIKE '%${user.accountAddress}%') and createDateTime >='${before24Hours}' and lastBoughtPack > 0 group by node;`;
    const queryTeamInactiveCount = `SELECT COUNT(distinct id) as amount, node FROM cubix.module_networking_users where (parents LIKE '%${user.accountAddress}%' OR sponsorTree LIKE '%${user.accountAddress}%') and createDateTime >='${before24Hours}' and lastBoughtPack <= 0 group by node;`;
    const queryAllStats = `SELECT SUM(amount) as amount, bonusType FROM cubix.module_networking_user_bonus where userId='${query.userId}' group by bonusType;`;
    const queryTeamCountAll = `SELECT COUNT(distinct id) as amount, node FROM cubix.module_networking_users where (parents LIKE '%${user.accountAddress}%' OR sponsorTree LIKE '%${user.accountAddress}%') group by node;`;

    console.log({
      querySponsor,
      queryTeamBonus,
      queryTeamMatchingBonus,
      queryDirectBonus,
      queryDirectInvestmentBonus,
      queryTeamBusiness,
      queryTeamCount,
      queryTeamInactiveCount,
      queryAllStats,
      queryTeamCountAll,
    });

    const [
      sponsorBonus,
      teamBonus,
      teamMatchingBonus,
      directPartner,
      directInvestment,
      teamBusiness,
      teamCount,
      teamInactiveCount,
      allStats,
      teamCountAll,
    ] = await Promise.all([
      bonusRepo.query(querySponsor),
      bonusRepo.query(queryTeamBonus),
      bonusRepo.query(queryTeamMatchingBonus),
      bonusRepo.query(queryDirectBonus),
      bonusRepo.query(queryDirectInvestmentBonus),
      bonusRepo.query(queryTeamBusiness),
      bonusRepo.query(queryTeamCount),
      bonusRepo.query(queryTeamInactiveCount),
      bonusRepo.query(queryAllStats),
      bonusRepo.query(queryTeamCountAll),
    ]);

    return {
      sponsorBonus,
      teamBonus,
      teamMatchingBonus,
      directPartner,
      directInvestment,
      teamBusiness,
      teamCount,
      teamInactiveCount,
      allStats,
      teamCountAll,
    };
  }

  async updateSponsorsIncomeOnlyBusinessVolume(
    sponsors: User[],
    user,
    packDetails: PackBought | any,
  ) {
    const userRepo = await this.userRepository();
    const userBusinessRepo = await this.userBusinessRepository();

    const userBusinessRepoEntries = sponsors?.map((sponsor, index) => {
      // based on next child decide which tree needs to be updated
      const nextChildInTree = sponsors?.[index + 1] ?? user;
      // update team income
      const isFirstTeam = nextChildInTree?.node === 0;

      return {
        node: isFirstTeam ? 0 : 1,
        accountAddress: sponsor?.accountAddress,
        businessIncome: packDetails?.packPrice,
        joinedByAccountAddress: user?.accountAddress,
      };
    });

    // traverse tree upwards and increment business income
    const userRepoEntries = sponsors?.map((sponsor, index) => {
      Logger.log(
        `Manual Entry U: ${user?.accountAddress} P:${packDetails?.pack?._id}: BONUS ${sponsor?.accountAddress}: PARENT BUSINESS - ${packDetails?.packPrice}`,
      );

      // based on next child decide which tree needs to be updated
      const nextChildInTree = sponsors?.[index + 1] ?? user;
      // update team income
      const isFirstTeam = nextChildInTree?.node === 0;

      return {
        id: sponsor?.id,
        accountAddress: sponsor.accountAddress,
        businessIncome: sponsor?.businessIncome + packDetails?.packPrice,
        businessIncomeFirstTeam: isFirstTeam
          ? sponsor?.businessIncomeFirstTeam + packDetails?.packPrice
          : sponsor?.businessIncomeFirstTeam,
        businessIncomeSecondTeam: !isFirstTeam
          ? sponsor?.businessIncomeSecondTeam + packDetails?.packPrice
          : sponsor?.businessIncomeSecondTeam,
      };
    });

    return {
      userBusinessRepoEntries,
      userRepoEntries,
    };
    await Promise.all([
      userBusinessRepo.save(userBusinessRepoEntries),
      userRepo.save(userRepoEntries),
    ]);
  }

  async updateTeamMatchingSponsorBonusManual(
    user: User,
    sponsors: User[],
    packDetails: PackBought,
  ) {
    const bonusRepo = await this.userBonusRepository();

    const userRepoEntries = sponsors
      ?.map((sponsor) => {
        // based on level provide team direct bonus
        // based on level provide team matching direct bonus
        const firstTeamIncome =
          sponsor?.businessIncomeFirstTeam -
          sponsor?.businessIncomeFirstDeltaTeam;
        const secondTeamIncome =
          sponsor?.businessIncomeSecondTeam -
          sponsor?.businessIncomeSecondDeltaTeam;

        Logger.log(
          `Manual Entry U: ${user?.accountAddress} P:${packDetails?.pack?._id}: TEAM MATCHING BONUS INCOME CHECK ${sponsor?.accountAddress}:
        firstTeamIncome: ${firstTeamIncome}
        secondTeamIncome: ${secondTeamIncome}
        `,
        );
        if (secondTeamIncome <= 0 || firstTeamIncome <= 0) {
          return null;
        }

        const eligibleIncomeForMatching =
          firstTeamIncome > secondTeamIncome
            ? secondTeamIncome
            : firstTeamIncome;

        const teamMatchingSponsorBonus =
          eligibleIncomeForMatching * (teamMatchingBonusPercentage / 100);

        let teamMatchingDirectSponsorBonus = 0;

        // not root as well
        if (
          user?.sponsorTree?.includes(sponsor?.accountAddress)
          // &&
          // sponsor?.accountAddress !==
          //   user?.sponsorTree?.[user?.sponsorTree.length - 1]
        ) {
          // add on matching will be not given to user who referred this sponsor
          teamMatchingDirectSponsorBonus =
            teamMatchingSponsorBonus *
            (sponsor?.profile?.directSponsorBonus / 100);
        }

        Logger.log(
          `Manual Entry ------------------------ BINARY DISTRIBUTION ------------------------ ${user?.accountAddress?.toLowerCase()}-${
            packDetails?.pack?._id
          }`,
        );
        Logger.log(
          `Manual Entry U: ${user?.accountAddress} 
            P:${packDetails?.pack?._id}: 
            Binary tp ${sponsor?.accountAddress}:
            Add On matching to accountAddress ${sponsor?.referredBy?.accountAddress}:
            eligibleIncomeForMatching: ${eligibleIncomeForMatching}
            teamMatchingSponsorBonus: ${teamMatchingSponsorBonus}
            teamMatchingDirectSponsorBonus: ${teamMatchingDirectSponsorBonus}
        `,
        );
        Logger.log(
          'Manual Entry ------------------------ BINARY DISTRIBUTION ------------------------',
        );

        return {
          id: sponsor?.id,
          referredBy: sponsor?.referredBy,
          businessIncomeSecondDeltaTeam:
            sponsor?.businessIncomeSecondDeltaTeam + eligibleIncomeForMatching,
          businessIncomeFirstDeltaTeam:
            sponsor?.businessIncomeFirstDeltaTeam + eligibleIncomeForMatching,
          teamMatchingBonus:
            teamMatchingSponsorBonus > 0
              ? sponsor.teamMatchingBonus + teamMatchingSponsorBonus
              : sponsor.teamMatchingBonus,
          directMatchingBonus:
            teamMatchingDirectSponsorBonus > 0
              ? sponsor?.directMatchingBonus + teamMatchingDirectSponsorBonus
              : sponsor?.directMatchingBonus,
          teamMatchingSponsorBonus,
          teamMatchingDirectSponsorBonus,
          sponsor,
          teamMatchingBonusPercentage,
        };
      })
      .filter((_d) => _d?.id);

    const teamMatchingSponsorBonusEntries = userRepoEntries
      ?.filter((_userRepoEntries) => {
        return _userRepoEntries.teamMatchingSponsorBonus > 0;
      })
      .map((_userRepoEntry) => {
        return {
          amount: _userRepoEntry.teamMatchingSponsorBonus,
          bonusFrom: user,
          bonusType: BonusTypes.team,
          user: _userRepoEntry.sponsor,
          packBought: packDetails,
          userLevel: _userRepoEntry.sponsor?.profile?._id,
          percentage: _userRepoEntry.teamMatchingBonusPercentage,
          canClaim: true,
          flushAmount: 0,
        };
      });

    return teamMatchingSponsorBonusEntries;
    await bonusRepo.save(teamMatchingSponsorBonusEntries);
  }
}
