package authz

const ResourceLottery = "lottery"

var (
	LotteryRead    = Permission{Resource: ResourceLottery, Action: ActionRead}
	LotteryWrite   = Permission{Resource: ResourceLottery, Action: ActionWrite}
	LotteryPublish = Permission{Resource: ResourceLottery, Action: "publish"}
	LotteryOperate = Permission{Resource: ResourceLottery, Action: ActionOperate}
	LotteryStock   = Permission{Resource: ResourceLottery, Action: "stock"}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceLottery,
		LabelKey: "Lottery management",
		Actions: []ActionDefinition{
			{Action: ActionRead, LabelKey: "View lottery activities", DescriptionKey: "View lottery activities, versions, prizes, and audit records."},
			{Action: ActionWrite, LabelKey: "Edit lottery drafts", DescriptionKey: "Create and edit lottery activities, versions, and prizes."},
			{Action: "publish", LabelKey: "Publish lottery versions", DescriptionKey: "Publish a frozen lottery configuration for a future business date."},
			{Action: ActionOperate, LabelKey: "Operate lottery activities", DescriptionKey: "Pause, resume, or end lottery activities."},
			{Action: "stock", LabelKey: "Adjust lottery stock", DescriptionKey: "Add inventory to lottery balance prizes."},
		},
	})
}
