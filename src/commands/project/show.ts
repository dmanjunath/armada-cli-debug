import { Arg } from "@oclif/core/lib/interfaces";
import { BlockchainCommand } from "../../base";
import { getContract, getProvider, normalizeHash, normalizeRecord, pretty } from "../../helpers";

export default class ProjectShow extends BlockchainCommand {
  static summary = "Show details of an Armada Network project.";
  static examples = ["<%= config.bin %> <%= command.id %> 0x123abc..."];
  static usage = "<%= command.id %> ID";
  static args: Arg[] = [{ name: "ID", description: "The ID of the project to show.", required: true }];

  public async run(): Promise<Record<string, unknown>> {
    const { args, flags } = await this.parse(ProjectShow);
    const provider = await getProvider(flags.network, flags.rpc);
    const projects = await getContract(flags.network, flags.abi, "ArmadaProjects", provider);
    const projectId = normalizeHash(args.ID);
    const record = await projects.getProject(projectId);
    const output = normalizeRecord(record);
    this.log(pretty(output));
    return output;
  }
}
